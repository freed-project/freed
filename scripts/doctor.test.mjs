import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyBinaryArch,
  checkAutomationStateDir,
  checkKernelGuardTool,
  checkReleaseTagPublisherConfig,
  checkTrustedPublisherConfig,
  credentialHelperBinary,
  evaluateGhCheck,
  formatReport,
  kernelGuardToolForPlatform,
  remediationForCommandFailure,
  resolveExitCode,
  runChecks,
} from "./doctor.mjs";
import {
  automationKernelGuardMarkerBytes,
  inspectAutomationKernelGuardCutover,
} from "./lib/automation-kernel-guard-contract.mjs";
import {
  installAutomationKernelGuardCutoverFixture,
  rewriteAutomationKernelGuardCutoverTransactionFixture,
} from "./test-helpers/automation-kernel-guard.mjs";
import { releaseTagPublisherNativePairSha256 } from "./lib/release-tag-publisher-binding.mjs";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${stableJson(value)}\n`, "utf8");
}

function writePrettyJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}

function installKernelGuardCutoverFixture(stateDir) {
  return installAutomationKernelGuardCutoverFixture(stateDir).paths;
}

function releasePublisherBinding(hostPath, provisionerPath, overrides = {}) {
  const binding = {
    schemaVersion: 3,
    purpose: "freed-release-tag-publisher-binding",
    status: "active",
    repo: "freed-project/freed",
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    publisherPath: hostPath,
    publisherSha256: sha256(hostPath),
    publisherCdHash: "c".repeat(40),
    provisionerPath,
    provisionerSha256: sha256(provisionerPath),
    provisionerCdHash: "d".repeat(40),
    ...overrides,
  };
  return {
    ...binding,
    nativePairSha256:
      overrides.nativePairSha256 ??
      releaseTagPublisherNativePairSha256(binding),
  };
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

test("kernel guard preflight selects the platform system primitive", () => {
  assert.equal(kernelGuardToolForPlatform("darwin"), "/usr/bin/lockf");
  assert.equal(kernelGuardToolForPlatform("linux"), "/usr/bin/flock");
  assert.equal(kernelGuardToolForPlatform("win32"), "");
  assert.equal(checkKernelGuardTool(process.platform).status, "ok");
  assert.equal(checkKernelGuardTool("win32").status, "fail");
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

test("automation state preflight rejects legacy directory guards", () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-legacy-guard-")),
  );
  const stateDir = path.join(root, "automation");
  const guardsDir = path.join(stateDir, "control", ".guards");
  mkdirSync(path.join(guardsDir, "events.lock"), {
    recursive: true,
    mode: 0o700,
  });
  chmodSync(stateDir, 0o700);
  chmodSync(path.join(stateDir, "control"), 0o700);
  chmodSync(guardsDir, 0o700);

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(result.detail, /kernel guard|cutover|events\.lock/i);
  assert.match(result.remediation, /PAUSED/);
  assert.match(result.remediation, /automation:cutover-kernel-guards/);
  const applyLine = result.remediation
    .split("\n")
    .find((line) => line.includes(" -- apply "));
  assert.ok(applyLine);
  assert.doesNotMatch(applyLine, /--state-root/);
});

test("automation state preflight rejects a regular file at the guards path without throwing", () => {
  const stateDir = path.join(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-guards-file-")),
    "automation",
  );
  const controlDir = path.join(stateDir, "control");
  mkdirSync(controlDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
  chmodSync(controlDir, 0o700);
  writeFileSync(path.join(controlDir, ".guards"), "not a directory\n", {
    mode: 0o600,
  });

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(result.detail, /\.guards is not a physical directory/);
});

test("automation state preflight rejects a symlinked guards path without scanning its target", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-doctor-guards-symlink-"),
  );
  const stateDir = path.join(root, "automation");
  const controlDir = path.join(stateDir, "control");
  const externalGuardsDir = path.join(root, "external-guards");
  mkdirSync(controlDir, { recursive: true, mode: 0o700 });
  mkdirSync(externalGuardsDir, { mode: 0o700 });
  chmodSync(stateDir, 0o700);
  chmodSync(controlDir, 0o700);
  writeFileSync(path.join(externalGuardsDir, "followed.lock"), "{}\n", {
    mode: 0o644,
  });
  symlinkSync(externalGuardsDir, path.join(controlDir, ".guards"));

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(result.detail, /\.guards is not a physical directory/);
  assert.doesNotMatch(result.detail, /followed\.lock/);
});

test("automation state preflight rejects a symlinked state root without scanning descendants", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-doctor-state-symlink-"),
  );
  const externalStateDir = path.join(root, "external-automation");
  const externalGuardsDir = path.join(externalStateDir, "control", ".guards");
  mkdirSync(externalGuardsDir, { recursive: true, mode: 0o700 });
  chmodSync(externalStateDir, 0o700);
  chmodSync(path.join(externalStateDir, "control"), 0o700);
  chmodSync(externalGuardsDir, 0o700);
  writeFileSync(path.join(externalGuardsDir, "followed.lock"), "{}\n", {
    mode: 0o644,
  });
  writeFileSync(
    path.join(externalStateDir, "outcomes.jsonl.writer-lock"),
    "external writer lock\n",
    { mode: 0o644 },
  );
  const stateDir = path.join(root, "automation");
  symlinkSync(externalStateDir, stateDir);

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(result.detail, /automation is not a physical directory/);
  assert.doesNotMatch(result.detail, /followed\.lock/);
  assert.doesNotMatch(result.detail, /outcomes\.jsonl\.writer-lock/);
});

test("automation state preflight rejects a symlinked control ancestor without scanning guards", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-doctor-control-symlink-"),
  );
  const stateDir = path.join(root, "automation");
  const externalControlDir = path.join(root, "external-control");
  const externalGuardsDir = path.join(externalControlDir, ".guards");
  mkdirSync(stateDir, { mode: 0o700 });
  mkdirSync(externalGuardsDir, { recursive: true, mode: 0o700 });
  chmodSync(externalControlDir, 0o700);
  chmodSync(externalGuardsDir, 0o700);
  writeFileSync(path.join(externalGuardsDir, "followed.lock"), "{}\n", {
    mode: 0o644,
  });
  symlinkSync(externalControlDir, path.join(stateDir, "control"));

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(result.detail, /control is not a physical directory/);
  assert.doesNotMatch(result.detail, /followed\.lock/);
});

test("automation state preflight checks private outcome repair directories", () => {
  const stateDir = path.join(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-repair-dirs-")),
    "automation",
  );
  const transactionDir = path.join(
    stateDir,
    "control",
    "outcome-ledger-transactions",
  );
  const artifactDir = path.join(stateDir, "artifacts", "outcome-ledger-repair");
  mkdirSync(transactionDir, { recursive: true, mode: 0o700 });
  mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
  chmodSync(path.join(stateDir, "control"), 0o700);
  chmodSync(path.join(stateDir, "artifacts"), 0o700);
  chmodSync(transactionDir, 0o755);
  chmodSync(artifactDir, 0o755);

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(result.detail, /outcome-ledger-transactions is not mode 0700/);
  assert.match(result.detail, /outcome-ledger-repair is not mode 0700/);
});

test("automation state preflight accepts only the exact completed kernel guard cutover", () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-kernel-cutover-")),
  );
  const stateDir = path.join(root, "automation");
  mkdirSync(stateDir, { mode: 0o700 });
  const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
  installDoctorLeaseArchiveFixture(stateDir, "a", { includeEntry: false });

  assert.equal(
    lstatSync(fixture.evidence.authorizationRoot).mode & 0o7777,
    0o700,
  );
  assert.deepEqual(
    readdirSync(fixture.evidence.authorizationRoot).sort(),
    [
      path.basename(fixture.evidence.confirmationArtifact),
      "prepared-authorization.json",
    ].sort(),
  );

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "ok");
  assert.match(result.detail, /complete permanent kernel guard cutover/);
  assert.match(result.detail, /Lease cleanup archive: 0 entries/);
});

function installDoctorLeaseArchiveFixture(
  stateDir,
  suffix = "a",
  { includeEntry = true } = {},
) {
  const leases = path.join(stateDir, "control", "leases");
  const transactions = path.join(leases, ".transactions");
  const receipts = path.join(leases, ".transaction-receipts");
  const archive = path.join(transactions, ".lease-cleanup-quarantine");
  const receiptArchive = path.join(receipts, ".lease-cleanup-quarantine");
  const leaseStateQuarantine = path.join(leases, ".lease-state-quarantine");
  for (const directory of [
    leases,
    transactions,
    receipts,
    archive,
    receiptArchive,
    leaseStateQuarantine,
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  const archivePath = includeEntry
    ? path.join(archive, `${suffix.repeat(64)}.${"b".repeat(64)}.json`)
    : null;
  if (archivePath !== null) {
    writeFileSync(archivePath, "{}\n", { mode: 0o600 });
  }
  return { archive, archivePath };
}

test("automation state preflight reports safe lease archive accounting", () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-lease-archive-")),
  );
  const stateDir = path.join(root, "automation");
  mkdirSync(stateDir, { mode: 0o700 });
  installAutomationKernelGuardCutoverFixture(stateDir);
  installDoctorLeaseArchiveFixture(stateDir);

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "ok");
  assert.match(result.detail, /Lease cleanup archive: 1 entries, 3 bytes/);
  assert.match(result.detail, /projected next-operation use 9 entries/);
  assert.match(result.detail, /bytes free on local/);
});

test("automation state preflight rejects old, symlinked, and special lease archives", async (t) => {
  await t.test("oldest age", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-lease-age-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    installAutomationKernelGuardCutoverFixture(stateDir);
    const { archivePath } = installDoctorLeaseArchiveFixture(stateDir);
    const old = new Date(Date.now() - 367 * 24 * 60 * 60 * 1_000);
    utimesSync(archivePath, old, old);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /oldest-age limit is exhausted/);
    assert.match(result.remediation, /owner-authorized archive compaction/);
  });

  for (const kind of ["symlink", "directory"]) {
    await t.test(kind, () => {
      const root = realpathSync(
        mkdtempSync(path.join(os.tmpdir(), `freed-doctor-lease-${kind}-`)),
      );
      const stateDir = path.join(root, "automation");
      mkdirSync(stateDir, { mode: 0o700 });
      installAutomationKernelGuardCutoverFixture(stateDir);
      const { archive } = installDoctorLeaseArchiveFixture(stateDir);
      const entryPath = path.join(
        archive,
        `${"c".repeat(64)}.${"d".repeat(64)}.json`,
      );
      if (kind === "symlink") {
        symlinkSync(path.join(archive, `${"a".repeat(64)}.${"b".repeat(64)}.json`), entryPath);
      } else {
        mkdirSync(entryPath, { mode: 0o700 });
      }

      const result = checkAutomationStateDir(stateDir);

      assert.equal(result.status, "fail");
      assert.match(result.detail, /not one private physical regular file/);
      assert.match(result.remediation, /owner-authorized archive compaction/);
    });
  }

  for (const mode of [0o4600, 0o2600, 0o700]) {
    await t.test(`archive file mode ${mode.toString(8)}`, () => {
      const root = realpathSync(
        mkdtempSync(path.join(os.tmpdir(), "freed-doctor-lease-file-mode-")),
      );
      const stateDir = path.join(root, "automation");
      mkdirSync(stateDir, { mode: 0o700 });
      installAutomationKernelGuardCutoverFixture(stateDir);
      const { archivePath } = installDoctorLeaseArchiveFixture(stateDir);
      chmodSync(archivePath, mode);

      const result = checkAutomationStateDir(stateDir);

      assert.equal(result.status, "fail");
      assert.match(result.detail, /not one private physical regular file/);
    });
  }

  await t.test("sticky archive directory", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-lease-dir-mode-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    installAutomationKernelGuardCutoverFixture(stateDir);
    const { archive } = installDoctorLeaseArchiveFixture(stateDir);
    chmodSync(archive, 0o1700);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /could not be pinned to one directory generation/);
  });

  await t.test("symlinked archive directory", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-lease-dir-symlink-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    installAutomationKernelGuardCutoverFixture(stateDir);
    const { archive } = installDoctorLeaseArchiveFixture(stateDir);
    const externalArchive = path.join(root, "external-archive");
    mkdirSync(externalArchive, { mode: 0o700 });
    rmSync(archive, { recursive: true, force: true });
    symlinkSync(externalArchive, archive);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /not a physical directory owned by the current user/);
  });
});

test("automation state preflight requires the complete prepared cutover evidence", async (t) => {
  const cases = [
    {
      label: "deleted plan",
      mutate: ({ evidence }) => rmSync(evidence.plan),
      problem: /exact cutover evidence set/,
    },
    {
      label: "corrupt plan",
      mutate: ({ evidence }) =>
        writeFileSync(evidence.plan, "{}\n", { mode: 0o600 }),
      problem: /exact production governance contract/,
    },
    {
      label: "deleted source snapshot",
      mutate: ({ evidence }) => rmSync(evidence.sourceSnapshot),
      problem: /exact cutover evidence set/,
    },
    {
      label: "corrupt source snapshot",
      mutate: ({ evidence }) =>
        writeFileSync(evidence.sourceSnapshot, "{}\n", { mode: 0o600 }),
      problem:
        /source-snapshot\.json does not match its exact source snapshot digest/,
    },
    {
      label: "deleted legacy archive entry",
      mutate: ({ evidence }) => rmSync(evidence.legacyGuardOwner),
      problem: /tasks\.lock does not preserve the exact legacy occurrence set/,
    },
    {
      label: "corrupt legacy archive entry",
      mutate: ({ evidence }) =>
        writeFileSync(evidence.legacyGuardOwner, "corrupt\n", { mode: 0o600 }),
      problem: /owner\.json does not preserve the exact legacy bytes/,
    },
    {
      label: "deleted prepared transaction",
      mutate: ({ evidence }) => rmSync(evidence.transaction),
      problem: /kernel-guard-cutover\.transaction\.json is not safely readable/,
    },
    {
      label: "corrupt prepared transaction",
      mutate: ({ evidence }) =>
        writeFileSync(evidence.transaction, "{}\n", { mode: 0o600 }),
      problem: /kernel-guard-cutover\.transaction\.json does not authenticate/,
    },
    {
      label: "deleted first authorization evidence",
      mutate: ({ evidence }) => rmSync(evidence.preparedAuthorization),
      problem:
        /authorizations does not contain the exact authorization evidence set/,
    },
    {
      label: "forged first authorization evidence",
      mutate: ({ evidence }) =>
        writeFileSync(evidence.preparedAuthorization, "{}\n", { mode: 0o600 }),
      problem: /does not bind the first validated authorization/,
    },
    {
      label: "permissive plan mode",
      mutate: ({ evidence }) => chmodSync(evidence.plan, 0o640),
      problem: /plan\.json is not safely readable/,
    },
    {
      label: "permissive authorization mode",
      mutate: ({ evidence }) => chmodSync(evidence.confirmationArtifact, 0o640),
      problem: /authorizations.*is not safely readable/,
    },
    {
      label: "permissive prepared authorization mode",
      mutate: ({ evidence }) =>
        chmodSync(evidence.preparedAuthorization, 0o640),
      problem: /prepared-authorization\.json is not safely readable/,
    },
    {
      label: "permissive receipt mode",
      mutate: ({ evidence }) => chmodSync(evidence.artifactReceipt, 0o640),
      problem: /receipt\.json is not safely readable/,
    },
  ];

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.label, () => {
      const root = realpathSync(
        mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-evidence-")),
      );
      const stateDir = path.join(root, "automation");
      mkdirSync(stateDir, { mode: 0o700 });
      const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
      fixtureCase.mutate(fixture);

      const result = checkAutomationStateDir(stateDir);

      assert.equal(result.status, "fail");
      assert.match(result.detail, fixtureCase.problem);
      assert.match(result.remediation, /automation:cutover-kernel-guards/);
    });
  }
});

test("automation state preflight requires the exact production cutover plan and owner intent", async (t) => {
  const cases = [
    {
      label: "extra plan parameter",
      mutatePlan: (plan) => {
        plan.parameters.unapproved = true;
      },
    },
    {
      label: "changed owner action",
      mutatePlan: (plan) => {
        plan.intent.action = "automation-guard.cutover.changed";
      },
    },
  ];

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.label, () => {
      const root = realpathSync(
        mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-plan-")),
      );
      const stateDir = path.join(root, "automation");
      mkdirSync(stateDir, { mode: 0o700 });
      const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
      fixtureCase.mutatePlan(fixture.plan);
      fixture.transaction.planDigest = createHash("sha256")
        .update(canonicalJsonBytes(fixture.plan))
        .digest("hex");
      writePrettyJson(fixture.evidence.plan, fixture.plan);
      writePrettyJson(fixture.evidence.transaction, fixture.transaction);

      const result = checkAutomationStateDir(stateDir);

      assert.equal(result.status, "fail");
      assert.match(result.detail, /exact production governance contract/);
    });
  }
});

test("automation state preflight requires the plan task in the canonical source manifest", () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-task-")),
  );
  const stateDir = path.join(root, "automation");
  mkdirSync(stateDir, { mode: 0o700 });
  installAutomationKernelGuardCutoverFixture(stateDir, {
    includeCanonicalTask: false,
  });

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(
    result.detail,
    /Canonical task kernel-guard-cutover-test does not exist/,
  );
});

test("automation state preflight rejects a malformed matching canonical task", () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-task-shape-")),
  );
  const stateDir = path.join(root, "automation");
  mkdirSync(stateDir, { mode: 0o700 });
  installAutomationKernelGuardCutoverFixture(stateDir, {
    canonicalTaskOverrides: { state: "invented-state" },
  });

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(
    result.detail,
    /canonical task manifest contains an unsupported task record/i,
  );
});

test("automation state preflight binds the receipt to exact transaction bytes", () => {
  const root = realpathSync(
    mkdtempSync(
      path.join(os.tmpdir(), "freed-doctor-cutover-transaction-digest-"),
    ),
  );
  const stateDir = path.join(root, "automation");
  mkdirSync(stateDir, { mode: 0o700 });
  const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
  fixture.transaction.claimGenerations[0].pid += 1;
  writePrettyJson(fixture.evidence.transaction, fixture.transaction);

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(
    result.detail,
    /transaction\.json does not authenticate the completed cutover/,
  );
});

test("automation state preflight binds the exact first owner authorization and claim history", async (t) => {
  await t.test("receipt authorization must be first", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-auth-first-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
    const original = fixture.transaction.authorizations[0];
    fixture.transaction.authorizations = [
      {
        ...original,
        confirmationId: "different-owner-confirmation",
        confirmationDigest: "7a".repeat(32),
      },
      original,
    ];
    writePrettyJson(fixture.evidence.transaction, fixture.transaction);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /does not authenticate the completed cutover/);
  });

  await t.test("authorization timestamp must be canonical", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-auth-time-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
    fixture.transaction.authorizations[0].validatedAt = "July 18 2026";
    writePrettyJson(fixture.evidence.transaction, fixture.transaction);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /does not authenticate the completed cutover/);
  });

  await t.test("transaction timestamp must be canonical", () => {
    const root = realpathSync(
      mkdtempSync(
        path.join(os.tmpdir(), "freed-doctor-cutover-transaction-time-"),
      ),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
    fixture.transaction.preparedAt = "July 18 2026";
    writePrettyJson(fixture.evidence.transaction, fixture.transaction);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /does not authenticate the completed cutover/);
  });

  await t.test("transaction uses the exact completed schema", () => {
    const root = realpathSync(
      mkdtempSync(
        path.join(os.tmpdir(), "freed-doctor-cutover-transaction-shape-"),
      ),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
    fixture.transaction.unapproved = true;
    writePrettyJson(fixture.evidence.transaction, fixture.transaction);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /does not authenticate the completed cutover/);
  });

  await t.test("completed transaction must retain a claim generation", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-claims-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
    fixture.transaction.claimGenerations = [];
    writePrettyJson(fixture.evidence.transaction, fixture.transaction);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /does not authenticate the completed cutover/);
  });

  await t.test("claim generation uses the exact schema", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-claim-shape-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
    fixture.transaction.claimGenerations[0].target = "writer";
    writePrettyJson(fixture.evidence.transaction, fixture.transaction);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /does not authenticate the completed cutover/);
  });

  await t.test("duplicate owner authorization identity is rejected", () => {
    const root = realpathSync(
      mkdtempSync(
        path.join(os.tmpdir(), "freed-doctor-cutover-auth-duplicate-"),
      ),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
    fixture.transaction.authorizations.push({
      ...fixture.transaction.authorizations[0],
    });
    rewriteAutomationKernelGuardCutoverTransactionFixture(fixture);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /does not authenticate the completed cutover/);
  });

  await t.test("owner authorization history is bounded", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-auth-bound-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
    const first = fixture.transaction.authorizations[0];
    fixture.transaction.authorizations = Array.from(
      { length: 65 },
      (_, index) =>
        index === 0
          ? first
          : {
              ...first,
              confirmationId: `owner-confirmation-${index.toLocaleString(
                "en-US",
                {
                  useGrouping: false,
                },
              )}`,
              confirmationDigest: createHash("sha256")
                .update(
                  `owner-confirmation-${index.toLocaleString("en-US", {
                    useGrouping: false,
                  })}`,
                )
                .digest("hex"),
            },
    );
    rewriteAutomationKernelGuardCutoverTransactionFixture(fixture);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /does not authenticate the completed cutover/);
  });

  await t.test("plan creation cannot follow transaction preparation", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-plan-order-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
    fixture.plan.createdAt = "2026-07-18T00:00:01.500Z";
    fixture.transaction.planDigest = createHash("sha256")
      .update(canonicalJsonBytes(fixture.plan))
      .digest("hex");
    writePrettyJson(fixture.evidence.plan, fixture.plan);
    rewriteAutomationKernelGuardCutoverTransactionFixture(fixture);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /does not authenticate the completed cutover/);
  });

  await t.test("claim generation cannot follow cutover completion", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-claim-order-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
    fixture.transaction.claimGenerations[0].claimedAt =
      "2026-07-18T00:00:03.000Z";
    rewriteAutomationKernelGuardCutoverTransactionFixture(fixture);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /does not authenticate the completed cutover/);
  });

  await t.test(
    "owner authorization cannot precede transaction preparation",
    () => {
      const root = realpathSync(
        mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-auth-order-")),
      );
      const stateDir = path.join(root, "automation");
      mkdirSync(stateDir, { mode: 0o700 });
      const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
      fixture.transaction.authorizations[0].validatedAt =
        "2026-07-18T00:00:00.500Z";
      rewriteAutomationKernelGuardCutoverTransactionFixture(fixture);

      const result = checkAutomationStateDir(stateDir);

      assert.equal(result.status, "fail");
      assert.match(
        result.detail,
        /does not authenticate the completed cutover/,
      );
    },
  );
});

test("automation state preflight requires exact receipt bytes and every evidence descendant", async (t) => {
  await t.test("global receipt must use production pretty bytes", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-global-bytes-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
    writeFileSync(
      fixture.evidence.globalReceipt,
      `${JSON.stringify(fixture.receipt)}\n`,
      { mode: 0o600 },
    );

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(
      result.detail,
      /not the exact pretty-printed activated receipt/,
    );
  });

  await t.test("bootstrap lock is part of completed evidence", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-bootstrap-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
    rmSync(fixture.paths.bootstrapLock);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /bootstrap\.lock.*not safely readable/);
  });

  await t.test(
    "symlinked archived descendant is rejected without following it",
    () => {
      const root = realpathSync(
        mkdtempSync(
          path.join(os.tmpdir(), "freed-doctor-cutover-archive-link-"),
        ),
      );
      const stateDir = path.join(root, "automation");
      mkdirSync(stateDir, { mode: 0o700 });
      const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
      const archivedGuard = path.dirname(fixture.evidence.legacyGuardOwner);
      const external = path.join(root, "external-guard");
      mkdirSync(external, { mode: 0o700 });
      writeFileSync(path.join(external, "owner.json"), "{}\n", { mode: 0o600 });
      rmSync(archivedGuard, { recursive: true });
      symlinkSync(external, archivedGuard);

      const result = checkAutomationStateDir(stateDir);

      assert.equal(result.status, "fail");
      assert.match(
        result.detail,
        /tasks\.lock.*private physical mode 0700 directory/,
      );
    },
  );
});

test("cutover inspection applies filesystem admission to nested evidence", () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-cutover-nested-fs-")),
  );
  const stateDir = path.join(root, "automation");
  mkdirSync(stateDir, { mode: 0o700 });
  const fixture = installAutomationKernelGuardCutoverFixture(stateDir);
  const nestedArchive = path.dirname(fixture.evidence.legacyGuardOwner);

  const inspection = inspectAutomationKernelGuardCutover(stateDir, {
    resolveFilesystemType: (candidatePath) =>
      candidatePath === nestedArchive ? "nfs" : "apfs",
  });

  assert.equal(inspection.ready, false);
  assert.match(
    inspection.problems.join("\n"),
    /tasks\.lock is not on the admitted apfs automation state filesystem/,
  );
});

test("automation state preflight rejects a missing cutover receipt", () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-missing-receipt-")),
  );
  const stateDir = path.join(root, "automation");
  mkdirSync(stateDir, { mode: 0o700 });
  const paths = installKernelGuardCutoverFixture(stateDir);
  rmSync(paths.globalReceipt);

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(result.detail, /kernel-guard-cutover\.json.*safely readable/);
  assert.match(result.remediation, /automation:cutover-kernel-guards/);
});

test("automation state preflight rejects a zero-byte writer sentinel", () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-zero-writer-")),
  );
  const stateDir = path.join(root, "automation");
  mkdirSync(stateDir, { mode: 0o700 });
  const paths = installKernelGuardCutoverFixture(stateDir);
  writeFileSync(paths.writerLock, "", { mode: 0o600 });

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(result.detail, /writer-lock.*exact guard marker/);
});

test("automation state preflight rejects a receipt with extra authority fields", () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-receipt-superset-")),
  );
  const stateDir = path.join(root, "automation");
  mkdirSync(stateDir, { mode: 0o700 });
  const paths = installKernelGuardCutoverFixture(stateDir);
  const receipt = JSON.parse(readFileSync(paths.globalReceipt, "utf8"));
  receipt.ownerOverride = true;
  writeFileSync(paths.globalReceipt, `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
  });

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(result.detail, /unsupported receipt shape/);
});

test("automation state preflight rejects a legacy writer lock record", () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-legacy-lock-")),
  );
  const stateDir = path.join(root, "automation");
  mkdirSync(stateDir, { mode: 0o700 });
  const paths = installKernelGuardCutoverFixture(stateDir);
  writeFileSync(
    paths.writerLock,
    `${JSON.stringify({ schemaVersion: 1, pid: 42 })}\n`,
    { mode: 0o600 },
  );

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(result.detail, /cutover|legacy|guard/i);
  assert.match(result.remediation, /PAUSED/);
});

test("automation state preflight rejects a partial writer lock marker", () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-partial-lock-")),
  );
  const stateDir = path.join(root, "automation");
  mkdirSync(stateDir, { mode: 0o700 });
  const paths = installKernelGuardCutoverFixture(stateDir);
  writeFileSync(
    paths.writerLock,
    '{"lockProtocol":"freed-kernel-file-lock-v1"',
    { mode: 0o600 },
  );

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(result.detail, /cutover|malformed|guard/i);
  assert.match(result.remediation, /PAUSED/);
});

test("automation state preflight rejects guard directory and inner marker drift", async (t) => {
  await t.test("guard directory mode", () => {
    const root = realpathSync(
      mkdtempSync(
        path.join(os.tmpdir(), "freed-doctor-guard-directory-drift-"),
      ),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const paths = installKernelGuardCutoverFixture(stateDir);
    chmodSync(paths.guards.events.directory, 0o755);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /events\.lock.*mode 0700/);
  });

  await t.test("inner marker bytes", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-inner-marker-drift-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const paths = installKernelGuardCutoverFixture(stateDir);
    writeFileSync(paths.guards.events.inner, "{}\n", { mode: 0o600 });

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(
      result.detail,
      /events\.lock.*kernel\.lock.*exact guard marker/,
    );
  });

  await t.test("inner marker symlink", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-inner-marker-symlink-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const paths = installKernelGuardCutoverFixture(stateDir);
    const external = path.join(root, "external-kernel.lock");
    writeFileSync(external, automationKernelGuardMarkerBytes(), {
      mode: 0o600,
    });
    rmSync(paths.guards.events.inner);
    symlinkSync(external, paths.guards.events.inner);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /events\.lock.*kernel\.lock.*safely readable/);
  });
});

test("automation state preflight rejects executable and special writer lock modes", async (t) => {
  for (const [label, mode] of [
    ["0700", 0o700],
    ["04600", 0o4600],
  ]) {
    await t.test(`mode ${label}`, () => {
      const root = realpathSync(
        mkdtempSync(path.join(os.tmpdir(), "freed-doctor-lock-mode-")),
      );
      const stateDir = path.join(root, "automation");
      mkdirSync(stateDir, { mode: 0o700 });
      const paths = installKernelGuardCutoverFixture(stateDir);
      chmodSync(paths.writerLock, mode);

      const result = checkAutomationStateDir(stateDir);

      assert.equal(result.status, "fail");
      assert.match(result.detail, /writer-lock.*mode 0600/);
    });
  }
});

test("automation state preflight rejects symlinked and directory writer locks", async (t) => {
  await t.test("symlink", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-lock-symlink-")),
    );
    const stateDir = path.join(root, "automation");
    const externalLockPath = path.join(root, "external.lock");
    mkdirSync(stateDir, { mode: 0o700 });
    const paths = installKernelGuardCutoverFixture(stateDir);
    writeFileSync(externalLockPath, automationKernelGuardMarkerBytes(), {
      mode: 0o600,
    });
    rmSync(paths.writerLock);
    symlinkSync(externalLockPath, paths.writerLock);

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /writer-lock.*safely readable/);
  });

  await t.test("directory", () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-doctor-lock-directory-")),
    );
    const stateDir = path.join(root, "automation");
    mkdirSync(stateDir, { mode: 0o700 });
    const paths = installKernelGuardCutoverFixture(stateDir);
    rmSync(paths.writerLock);
    mkdirSync(paths.writerLock, { mode: 0o700 });

    const result = checkAutomationStateDir(stateDir);

    assert.equal(result.status, "fail");
    assert.match(result.detail, /writer-lock.*safely readable/);
  });
});

test("trusted publisher config fails closed without a valid host handoff", () => {
  const home = mkdtempSync(
    path.join(os.tmpdir(), "freed-doctor-publisher-missing-"),
  );
  const configPath = path.join(home, "missing.json");
  const missing = checkTrustedPublisherConfig({}, home, { configPath });
  assert.equal(missing.status, "warn");
  assert.match(missing.detail, /broker-backed publication stays unavailable/);
  assert.match(
    missing.detail,
    /normal GitHub-authenticated publication remains available/,
  );

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
  assert.match(result.detail, /broker-backed publication stays unavailable/);
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
  const releasePublisherClosed = {
    checks: [{ id: "release-tag-publisher", status: "fail" }],
    failures: 1,
    warnings: 0,
  };
  const releasePublisherReady = {
    checks: [{ id: "release-tag-publisher", status: "ok" }],
    failures: 0,
    warnings: 0,
  };
  assert.equal(resolveExitCode(failing), 0);
  assert.equal(resolveExitCode(failing, { strict: true }), 1);
  assert.equal(resolveExitCode(clean, { strict: true }), 0);
  assert.equal(resolveExitCode(publisherClosed, { requirePublisher: true }), 1);
  assert.equal(resolveExitCode(publisherReady, { requirePublisher: true }), 0);
  assert.equal(
    resolveExitCode(releasePublisherClosed, {
      requireReleasePublisher: true,
    }),
    1,
  );
  assert.equal(
    resolveExitCode(releasePublisherReady, {
      requireReleasePublisher: true,
    }),
    0,
  );
});

test("release publisher doctor profile is separate and uses native ACL inspection", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-doctor-release-publisher-"),
  );
  const hostPath = path.join(root, "release-tag-publisher");
  const provisionerPath = path.join(root, "release-tag-publisher-provision");
  const configPath = path.join(root, "release-tag-publisher.json");
  writeFileSync(hostPath, "host", { mode: 0o700 });
  writeFileSync(provisionerPath, "provisioner", { mode: 0o700 });
  writeFileSync(
    configPath,
    `${JSON.stringify(releasePublisherBinding(hostPath, provisionerPath))}\n`,
    { mode: 0o600 },
  );
  const calls = [];
  const inspected = [];
  const ready = checkReleaseTagPublisherConfig({
    configPath,
    hostPath,
    provisionerPath,
    inspectPath(filePath, label, options) {
      inspected.push({ filePath, label, options });
      return [];
    },
    readConfig(filePath) {
      return readFileSync(filePath, "utf8");
    },
    platform: "darwin",
    run(file, args, options) {
      calls.push({ file, args, options });
      const binding = releasePublisherBinding(hostPath, provisionerPath);
      return {
        status: 0,
        stdout: JSON.stringify({
          schemaVersion: 3,
          purpose: "freed-release-tag-publisher-readiness",
          repo: binding.repo,
          appId: binding.appId,
          appSlug: binding.appSlug,
          credentialMode: "short-lived-installation-token",
          operations: ["create-annotated-tag"],
          allowsArbitraryRefs: false,
          allowsUpdates: false,
          allowsDeletions: false,
          publisherSha256: binding.publisherSha256,
          publisherCdHash: binding.publisherCdHash,
          provisionerSha256: binding.provisionerSha256,
          provisionerCdHash: binding.provisionerCdHash,
          nativePairSha256: binding.nativePairSha256,
        }),
      };
    },
  });
  assert.equal(ready.status, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, hostPath);
  assert.deepEqual(calls[0].args, [
    "attest",
    "--repo",
    "freed-project/freed",
    "--app-id",
    "4296969",
    "--app-slug",
    "freed-release-publisher",
  ]);
  assert.deepEqual(calls[0].options, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      HOME: process.env.HOME ?? "",
      PATH: "/usr/bin:/bin",
    },
    timeout: 5_000,
    maxBuffer: 64 * 1_024,
  });
  assert.deepEqual(
    inspected.map(({ filePath, options }) => ({ filePath, options })),
    [
      {
        filePath: hostPath,
        options: {
          executable: true,
          exactMode: 0o555,
          exactGroup: 0,
          exactLinkCount: 1,
        },
      },
      {
        filePath: provisionerPath,
        options: {
          executable: true,
          exactMode: 0o555,
          exactGroup: 0,
          exactLinkCount: 1,
        },
      },
      {
        filePath: configPath,
        options: {
          executable: false,
          exactMode: 0o444,
          exactGroup: 0,
          exactLinkCount: 1,
        },
      },
    ],
  );

  const missing = checkReleaseTagPublisherConfig({
    configPath,
    hostPath,
    provisionerPath,
    inspectPath: () => [],
    readConfig: (filePath) => readFileSync(filePath, "utf8"),
    platform: "darwin",
    run: () => ({ status: 1 }),
  });
  assert.equal(missing.status, "fail");
  assert.match(missing.detail, /could not validate.*Keychain item and ACL/);
});

test("release publisher doctor never reads or executes after path admission failure", () => {
  let reads = 0;
  let runs = 0;
  const result = checkReleaseTagPublisherConfig({
    configPath: "/untrusted/config",
    hostPath: "/untrusted/host",
    provisionerPath: "/untrusted/provisioner",
    inspectPath(filePath) {
      return filePath.endsWith("host") ? ["the host path is untrusted"] : [];
    },
    readConfig() {
      reads += 1;
      return "{}";
    },
    run() {
      runs += 1;
      return { status: 0 };
    },
    platform: "darwin",
  });
  assert.equal(result.status, "fail");
  assert.equal(reads, 0);
  assert.equal(runs, 0);
});

test("release publisher doctor never executes after invalid config admission", () => {
  let runs = 0;
  const result = checkReleaseTagPublisherConfig({
    configPath: "/admitted/config",
    hostPath: "/admitted/host",
    provisionerPath: "/admitted/provisioner",
    inspectPath: () => [],
    readConfig: () => JSON.stringify({ schemaVersion: 1 }),
    run() {
      runs += 1;
      return { status: 0 };
    },
    platform: "darwin",
  });
  assert.equal(result.status, "fail");
  assert.match(result.detail, /must contain exactly|binding is invalid/);
  assert.equal(runs, 0);
});

test("release publisher doctor rejects a mixed native generation before execution", (t) => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-doctor-release-publisher-mixed-"),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const hostPath = path.join(root, "release-tag-publisher");
  const provisionerPath = path.join(root, "release-tag-publisher-provision");
  const configPath = path.join(root, "release-tag-publisher.json");
  writeFileSync(hostPath, "host", { mode: 0o700 });
  writeFileSync(provisionerPath, "provisioner", { mode: 0o700 });
  let runs = 0;
  const checkBinding = (binding) =>
    checkReleaseTagPublisherConfig({
      configPath,
      hostPath,
      provisionerPath,
      inspectPath: () => [],
      readConfig: () => JSON.stringify(binding),
      run() {
        runs += 1;
        return { status: 0 };
      },
      platform: "darwin",
    });

  const wrongProvisioner = releasePublisherBinding(hostPath, provisionerPath, {
    provisionerSha256: "c".repeat(64),
  });
  const mixed = checkBinding(wrongProvisioner);
  assert.equal(mixed.status, "fail");
  assert.match(mixed.detail, /provisioner digest does not match/);
  assert.equal(runs, 0);

  const invalidPair = checkBinding(
    releasePublisherBinding(hostPath, provisionerPath, {
      nativePairSha256: "0".repeat(64),
    }),
  );
  assert.equal(invalidPair.status, "fail");
  assert.match(invalidPair.detail, /binding is invalid/);
  assert.equal(runs, 0);
});

test("release publisher doctor never executes native code off macOS", (t) => {
  let runs = 0;
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-doctor-release-publisher-platform-"),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const hostPath = path.join(root, "host");
  const provisionerPath = path.join(root, "provisioner");
  writeFileSync(hostPath, "host");
  writeFileSync(provisionerPath, "provisioner");
  const config = releasePublisherBinding(hostPath, provisionerPath);
  const result = checkReleaseTagPublisherConfig({
    configPath: "/admitted/config",
    hostPath,
    provisionerPath,
    inspectPath: () => [],
    readConfig: () => JSON.stringify(config),
    run() {
      runs += 1;
      return { status: 0 };
    },
    platform: "linux",
  });
  assert.equal(result.status, "fail");
  assert.match(result.detail, /supported only on macOS/);
  assert.equal(runs, 0);
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
    "kernel-guard",
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

test("runChecks adds Release Publisher readiness only when requested", () => {
  const stateDir = path.join(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-release-profile-")),
    "state",
  );
  const result = runChecks({
    stateDir,
    requireReleasePublisher: true,
    releaseTagPublisherCheck: {
      id: "release-tag-publisher",
      title: "release tag publisher",
      status: "ok",
      detail: "ready",
      remediation: "",
    },
  });
  assert.equal(
    result.checks.filter((item) => item.id === "release-tag-publisher").length,
    1,
  );
  const defaultResult = runChecks({ stateDir });
  assert.equal(
    defaultResult.checks.filter((item) => item.id === "release-tag-publisher")
      .length,
    0,
  );
});
