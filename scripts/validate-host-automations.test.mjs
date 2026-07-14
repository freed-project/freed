import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  actorCredentialReadiness,
  actorLauncherReadiness,
  auditSavedAutomations,
  authoritativeModelCatalog,
  formatHostAutomationAudit,
  inspectRootOwnedRuntimeFile,
  parseSavedAutomationToml,
  validateSavedSchedule,
} from "./validate-host-automations.mjs";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const NOW_MS = Date.parse("2026-07-10T20:05:00.000Z");

function fixture() {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-host-automations-")),
  );
  const repoRoot = path.join(root, "repo");
  const codexHome = path.join(root, ".codex");
  const stateRoot = path.join(root, ".freed", "automation");
  const launcherRecordRoot = path.join(root, "launcher-records");
  const runtimeRoot = path.join(root, "automation-actor-runtimes");
  const promptPath = path.join(
    repoRoot,
    "automation",
    "prompts",
    "freed-nightly-runner.md",
  );
  mkdirSync(path.dirname(promptPath), { recursive: true });
  writeFileSync(promptPath, "# Nightly\n\nUse the governed task queue.\n");
  const spec = {
    id: "freed-nightly-runner",
    name: "Freed nightly executor",
    kind: "cron",
    promptPath,
    authority: "merge-safe",
    lease: { name: "nightly-writer", maxLifetimeMs: 1_800_000 },
    localOverlayFields: [
      "status",
      "rrule",
      "model",
      "reasoning_effort",
      "execution_environment",
      "target",
      "cwds",
    ],
    requiredHostCapabilities: [
      "trusted-launcher",
      "short-lived-credential-handoff",
    ],
  };
  return {
    root,
    repoRoot,
    codexHome,
    stateRoot,
    launcherRecordRoot,
    runtimeRoot,
    promptPath,
    spec,
  };
}

function modelCatalog(reasoning = ["high"]) {
  return {
    fetched_at: "2026-07-10T20:00:00.000Z",
    models: [
      {
        slug: "gpt-5.6-sol",
        visibility: "list",
        supported_in_api: true,
        supported_reasoning_levels: reasoning.map((effort) => ({ effort })),
      },
    ],
  };
}

function tomlValue(field, value) {
  if (field === "target") {
    return `{ type = ${JSON.stringify(value.type)}, project_id = ${JSON.stringify(value.project_id)} }`;
  }
  return JSON.stringify(value);
}

function writeSavedAutomation(value, overrides = {}) {
  const automationDir = path.join(
    value.codexHome,
    "automations",
    value.spec.id,
  );
  mkdirSync(automationDir, { recursive: true });
  const saved = {
    id: value.spec.id,
    kind: value.spec.kind,
    name: value.spec.name,
    prompt: "# Nightly\n\nUse the governed task queue.",
    status: "PAUSED",
    rrule: "RRULE:FREQ=WEEKLY;BYHOUR=2;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA",
    model: "gpt-5.6-sol",
    reasoning_effort: "high",
    execution_environment: "worktree",
    target: { type: "project", project_id: sourceRoot },
    cwds: [sourceRoot],
    ...overrides,
  };
  writeFileSync(
    path.join(automationDir, "automation.toml"),
    Object.entries(saved)
      .filter(([, value_]) => value_ !== undefined)
      .map(([field, value_]) => `${field} = ${tomlValue(field, value_)}`)
      .join("\n") + "\n",
  );
}

function heartbeatFixture(overrides = {}) {
  const value = fixture();
  value.spec = {
    ...value.spec,
    id: "freed-runtime-observer",
    name: "Freed runtime observer",
    kind: "heartbeat",
    authority: "observe-only",
    lease: { name: "runtime-observer", maxLifetimeMs: 1_800_000 },
    localOverlayFields: ["status", "rrule", "destination", "target_thread_id"],
  };
  const automationDir = path.join(
    value.codexHome,
    "automations",
    value.spec.id,
  );
  mkdirSync(automationDir, { recursive: true });
  const saved = {
    id: value.spec.id,
    kind: value.spec.kind,
    name: value.spec.name,
    prompt: "# Nightly\n\nUse the governed task queue.",
    status: "PAUSED",
    rrule: "FREQ=MINUTELY;INTERVAL=30",
    destination: "thread",
    target_thread_id: "thread-123",
    ...overrides,
  };
  writeFileSync(
    path.join(automationDir, "automation.toml"),
    Object.entries(saved)
      .filter(([, savedValue]) => savedValue !== undefined)
      .map(
        ([field, savedValue]) =>
          `${field} = ${JSON.stringify(savedValue)}`,
      )
      .join("\n") + "\n",
  );
  return value;
}

function writeCredential(value) {
  const credentialDir = path.join(
    value.stateRoot,
    "control",
    "actor-credentials",
  );
  mkdirSync(credentialDir, { recursive: true, mode: 0o700 });
  const credentialPath = path.join(credentialDir, `${value.spec.id}.json`);
  writeFileSync(
    credentialPath,
    `${JSON.stringify({
      schemaVersion: 1,
      actor: value.spec.id,
      purpose: "automation-actor-lease",
      tokenSha256: "a".repeat(64),
    })}\n`,
    { mode: 0o600 },
  );
  return credentialPath;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function launcherAttestation(value, overrides = {}) {
  return {
    schemaVersion: 1,
    protocol: "freed-actor-launcher-readiness-v1",
    purpose: "automation-actor-launcher-readiness",
    actor: value.spec.id,
    stateRoot: realpathSync(value.stateRoot),
    leaseName: value.spec.lease.name,
    maxLeaseLifetimeMs: value.spec.lease.maxLifetimeMs,
    credentialSha256: "a".repeat(64),
    handoff: "keychain-to-canonical-lease",
    keychainService: "freed-automation-actor",
    keychainAccount: value.spec.id,
    credentialDigestVerified: true,
    canonicalLeaseReady: true,
    mutatesState: false,
    ...overrides,
  };
}

function writeLauncherRecord(
  value,
  {
    digest = undefined,
    attestationOverrides = {},
    runtimeDigestOverrides = {},
    runtimePathOverrides = {},
  } = {},
) {
  const attestation = launcherAttestation(value, attestationOverrides);
  const launcherContents =
    `#!/bin/sh\nprintf '%s\\n' ${shellQuote(JSON.stringify(attestation))}\n`;
  const launcherSha256 =
    digest ?? createHash("sha256").update(launcherContents).digest("hex");
  const launcherPath = path.join(
    value.launcherRecordRoot,
    "bin",
    `${value.spec.id}-${launcherSha256}`,
  );
  mkdirSync(path.dirname(launcherPath), { recursive: true, mode: 0o700 });
  writeFileSync(launcherPath, launcherContents, { mode: 0o700 });
  const runtimeContents = {
    nodePath: "pinned node fixture\n",
    controlEntryPath: "pinned control entry fixture\n",
    controlLibraryPath: "pinned control library fixture\n",
  };
  const runtimeDigests = Object.fromEntries(
    Object.entries(runtimeContents).map(([field, contents]) => [
      field.replace(/Path$/, "Sha256"),
      createHash("sha256").update(contents).digest("hex"),
    ]),
  );
  const runtimeDigest = createHash("sha256")
    .update(
      [
        "freed-automation-actor-runtime-v1",
        `node:${runtimeDigests.nodeSha256}`,
        `automation-control.mjs:${runtimeDigests.controlEntrySha256}`,
        `lib/automation-control.mjs:${runtimeDigests.controlLibrarySha256}`,
        "",
      ].join("\n"),
    )
    .digest("hex");
  const runtimeVersionRoot = path.join(value.runtimeRoot, runtimeDigest);
  const runtimePaths = {
    nodePath: path.join(runtimeVersionRoot, "node"),
    controlEntryPath: path.join(runtimeVersionRoot, "automation-control.mjs"),
    controlLibraryPath: path.join(
      runtimeVersionRoot,
      "lib",
      "automation-control.mjs",
    ),
    ...runtimePathOverrides,
  };
  for (const [field, runtimePath] of Object.entries(runtimePaths)) {
    mkdirSync(path.dirname(runtimePath), { recursive: true, mode: 0o700 });
    if (!runtimePathOverrides[field]) {
      writeFileSync(runtimePath, runtimeContents[field], { mode: 0o500 });
    }
  }
  const recordDir = value.launcherRecordRoot;
  mkdirSync(recordDir, { recursive: true, mode: 0o700 });
  const recordPath = path.join(recordDir, `${value.spec.id}.json`);
  writeFileSync(
    recordPath,
    `${JSON.stringify({
      schemaVersion: 1,
      actor: value.spec.id,
      purpose: "automation-actor-launcher",
      handoff: "keychain-to-canonical-lease",
      attestationProtocol: "freed-actor-launcher-readiness-v1",
      launcherPath,
      launcherSha256,
      ...runtimePaths,
      ...runtimeDigests,
      ...runtimeDigestOverrides,
      stateRoot: realpathSync(value.stateRoot),
      leaseName: value.spec.lease.name,
      maxLeaseLifetimeMs: value.spec.lease.maxLifetimeMs,
      keychainService: "freed-automation-actor",
      keychainAccount: value.spec.id,
    })}\n`,
    { mode: 0o600 },
  );
  return { launcherPath, recordPath };
}

function audit(value, options = {}) {
  return auditSavedAutomations({
    specs: [value.spec],
    repoRoot: value.repoRoot,
    codexHome: value.codexHome,
    stateRoot: value.stateRoot,
    launcherRecordRoot: value.launcherRecordRoot,
    launcherRecordInspector: () => ({ ready: true, reason: "" }),
    runtimeRoot: value.runtimeRoot,
    runtimeFileInspector: (runtimePath, runtimeRoot) =>
      inspectRootOwnedRuntimeFile(runtimePath, runtimeRoot, {
        requiredUid:
          typeof process.getuid === "function" ? process.getuid() : 0,
      }),
    modelCatalog: modelCatalog(),
    nowMs: NOW_MS,
    ...options,
  });
}

test("saved automation TOML preserves typed overlay values", () => {
  const parsed = parseSavedAutomationToml(
    [
      'id = "freed-nightly-runner"',
      'prompt = "line one\\nline two"',
      'status = "PAUSED"',
      'target = { type = "project", project_id = "/tmp/freed" }',
      'cwds = ["/tmp/freed"]',
    ].join("\n"),
  );
  assert.equal(parsed.prompt, "line one\nline two");
  assert.equal(parsed.status, "PAUSED");
  assert.deepEqual(parsed.target, {
    type: "project",
    project_id: "/tmp/freed",
  });
  assert.deepEqual(parsed.cwds, ["/tmp/freed"]);
});

test("saved automation TOML rejects duplicate governed fields", () => {
  assert.throws(
    () => parseSavedAutomationToml('status = "PAUSED"\nstatus = "ACTIVE"\n'),
    /status may only appear once/,
  );
});

test("schedule validation rejects self-expiring and kind-incompatible schedules", () => {
  assert.doesNotThrow(() =>
    validateSavedSchedule(
      "RRULE:FREQ=WEEKLY;BYHOUR=2;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA",
      "cron",
    ),
  );
  assert.doesNotThrow(() =>
    validateSavedSchedule("RRULE:FREQ=DAILY;BYHOUR=1;BYMINUTE=15", "cron"),
  );
  assert.throws(
    () => validateSavedSchedule("FREQ=DAILY;COUNT=1", "cron"),
    /must not contain DTSTART, COUNT, or UNTIL/,
  );
  assert.throws(
    () => validateSavedSchedule("FREQ=MINUTELY;INTERVAL=15", "cron"),
    /unsupported frequency/,
  );
  assert.throws(
    () => validateSavedSchedule("FREQ=DAILY;BYHOUR=1;BYMINUTE=15", "heartbeat"),
    /unsupported frequency/,
  );
});

test("heartbeat overlays validate cadence and thread target without a cron model", () => {
  const value = heartbeatFixture();
  const result = audit(value);
  assert.equal(result.issueCount, 0);
});

test("heartbeat destination may be omitted when a thread target is present", () => {
  const value = heartbeatFixture({ destination: undefined });
  const result = audit(value);

  assert.equal(result.issueCount, 0);
});

test("heartbeat rejects an explicit non-thread destination", () => {
  const value = heartbeatFixture({ destination: "project" });
  const result = audit(value);

  assert.deepEqual(result.records[0].issues, [
    {
      code: "target-drift",
      message: "heartbeat destination, when set, must be thread",
    },
  ]);
});

test("heartbeat still requires a target thread when destination is omitted", () => {
  const value = heartbeatFixture({
    destination: undefined,
    target_thread_id: undefined,
  });
  const result = audit(value);

  assert.deepEqual(result.records[0].issues, [
    {
      code: "target-drift",
      message: "heartbeat target_thread_id is required",
    },
  ]);
});

test("cron actors may use the owner-supplied cadence field instead of rrule", () => {
  const value = fixture();
  writeSavedAutomation(value, {
    rrule: undefined,
    cadence: "FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
  });
  const result = audit(value);
  assert.equal(result.issueCount, 0);
});

test("paused actor may await its owner-provisioned credential and launcher", () => {
  const value = fixture();
  writeSavedAutomation(value);
  const automationPath = path.join(
    value.codexHome,
    "automations",
    value.spec.id,
    "automation.toml",
  );
  const before = readFileSync(automationPath, "utf8");
  const result = audit(value);

  assert.equal(result.issueCount, 0);
  assert.equal(result.records[0].status, "PAUSED");
  assert.equal(result.records[0].handoffReady, false);
  assert.match(formatHostAutomationAudit(result), /\[PAUSED\]/);
  assert.match(
    formatHostAutomationAudit(result),
    /trusted launcher record is missing/,
  );
  assert.equal(readFileSync(automationPath, "utf8"), before);
});

test("clean active actor fails closed when the trusted handoff is absent", () => {
  const value = fixture();
  writeSavedAutomation(value, { status: "ACTIVE" });
  const result = audit(value);

  assert.deepEqual(
    result.records[0].issues.map((item) => item.code),
    ["active-without-trusted-handoff"],
  );
  assert.equal(result.records[0].handoffReady, false);
});

test("active actor fails closed when prompt drifts and trusted handoff is missing", () => {
  const value = fixture();
  writeSavedAutomation(value, {
    prompt: "old unsafe prompt",
    status: "ACTIVE",
  });
  const result = audit(value);
  const codes = result.records[0].issues.map((item) => item.code);

  assert.deepEqual(codes, ["prompt-drift", "active-without-trusted-handoff"]);
  assert.equal(result.issueCount, 2);
});

test("missing saved actor is reported as safely paused reconciliation drift", () => {
  const value = fixture();
  const result = audit(value);

  assert.equal(result.issueCount, 1);
  assert.equal(result.records[0].issues[0].code, "automation-missing");
  assert.equal(result.records[0].installed, false);
  assert.equal(result.records[0].status, "PAUSED");
});

test("matching active actor is valid only after the complete trusted handoff exists", () => {
  const value = fixture();
  writeSavedAutomation(value, { status: "ACTIVE" });
  writeCredential(value);
  writeLauncherRecord(value);
  const result = audit(value, {
    launcherInspector: () => ({ ready: true, reason: "" }),
  });

  assert.equal(result.issueCount, 0);
  assert.equal(result.records[0].handoffReady, true);
  assert.match(formatHostAutomationAudit(result), /\[ok\].*ACTIVE/);
});

test("saved overlay drift is detected for every safety and liveness field", () => {
  const cases = [
    [{ rrule: "FREQ=DAILY;COUNT=1" }, "schedule-drift"],
    [{ model: "gpt-next-guessed" }, "model-not-callable"],
    [{ reasoning_effort: "ultra" }, "reasoning-effort-unsupported"],
    [{ execution_environment: "local" }, "execution-environment-unsafe"],
    [{ target: { type: "project", project_id: "/tmp" } }, "target-drift"],
    [{ cwds: [sourceRoot, "/tmp"] }, "cwds-drift"],
  ];
  for (const [overrides, expectedCode] of cases) {
    const value = fixture();
    writeSavedAutomation(value, overrides);
    const codes = audit(value).records[0].issues.map((item) => item.code);
    assert.ok(
      codes.includes(expectedCode),
      `${expectedCode} missing from ${codes.join(", ")}`,
    );
  }
});

test("cron model validation fails closed when the authoritative catalog is unavailable", () => {
  const value = fixture();
  writeSavedAutomation(value);
  const result = audit(value, { modelCatalog: {} });
  assert.ok(
    result.records[0].issues.some(
      (item) => item.code === "model-catalog-unavailable",
    ),
  );
});

test("credential and launcher records reject permissive modes and digest drift", () => {
  const value = fixture();
  const credentialPath = writeCredential(value);
  chmodSync(credentialPath, 0o644);
  assert.equal(
    actorCredentialReadiness(value.stateRoot, value.spec.id).ready,
    false,
  );
  chmodSync(credentialPath, 0o600);
  const credential = actorCredentialReadiness(value.stateRoot, value.spec.id);

  const launcher = writeLauncherRecord(value, { digest: "0".repeat(64) });
  const readiness = actorLauncherReadiness(value.stateRoot, value.spec.id, {
    credential,
    leaseContract: value.spec.lease,
    launcherRecordRoot: value.launcherRecordRoot,
    launcherRecordInspector: () => ({ ready: true, reason: "" }),
    launcherInspector: () => ({ ready: true, reason: "" }),
    runtimeRoot: value.runtimeRoot,
    runtimeFileInspector: (runtimePath, runtimeRoot) =>
      inspectRootOwnedRuntimeFile(runtimePath, runtimeRoot, {
        requiredUid:
          typeof process.getuid === "function" ? process.getuid() : 0,
      }),
  });
  assert.equal(readiness.ready, false);
  assert.match(readiness.reason, /digest does not match/);
  assert.equal(launcher.recordPath.endsWith(`${value.spec.id}.json`), true);

  const untrustedRecord = actorLauncherReadiness(
    value.stateRoot,
    value.spec.id,
    {
      credential,
      leaseContract: value.spec.lease,
      launcherRecordRoot: value.launcherRecordRoot,
      launcherRecordInspector: () => ({
        ready: false,
        reason: "launcher record is not root-owned and immutable",
      }),
    },
  );
  assert.equal(untrustedRecord.ready, false);
  assert.match(untrustedRecord.reason, /not root-owned and immutable/);
});

test("credential readiness rejects a symlink without reading its target", () => {
  const value = fixture();
  const credentialPath = writeCredential(value);
  const targetPath = path.join(value.root, "credential-target.json");
  renameSync(credentialPath, targetPath);
  symlinkSync(targetPath, credentialPath);

  const readiness = actorCredentialReadiness(value.stateRoot, value.spec.id);

  assert.equal(readiness.ready, false);
  assert.match(readiness.reason, /cannot be read/);
});

test("general actor launcher records pin the complete root-owned runtime", () => {
  const value = fixture();
  writeCredential(value);
  const credential = actorCredentialReadiness(value.stateRoot, value.spec.id);
  const { recordPath } = writeLauncherRecord(value);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));

  for (const field of [
    "nodePath",
    "nodeSha256",
    "controlEntryPath",
    "controlEntrySha256",
    "controlLibraryPath",
    "controlLibrarySha256",
  ]) {
    assert.equal(Object.hasOwn(record, field), true, `${field} is missing`);
  }

  const readiness = actorLauncherReadiness(value.stateRoot, value.spec.id, {
    credential,
    leaseContract: value.spec.lease,
    launcherRecordRoot: value.launcherRecordRoot,
    launcherRecordInspector: () => ({ ready: true, reason: "" }),
    launcherInspector: () => ({ ready: true, reason: "" }),
    runtimeRoot: value.runtimeRoot,
    runtimeFileInspector: (runtimePath, runtimeRoot) =>
      inspectRootOwnedRuntimeFile(runtimePath, runtimeRoot, {
        requiredUid:
          typeof process.getuid === "function" ? process.getuid() : 0,
      }),
    launcherAttestor: () => ({
      ready: true,
      reason: "",
      attestation: launcherAttestation(value),
    }),
  });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.runtimeRoot, realpathSync(value.runtimeRoot));
  assert.equal(readiness.nodePath, record.nodePath);
  assert.equal(readiness.controlEntryPath, record.controlEntryPath);
  assert.equal(readiness.controlLibraryPath, record.controlLibraryPath);
});

test("general actor runtime pins reject missing fields, escapes, writable files, and digest drift", () => {
  const cases = [
    {
      name: "missing field",
      mutate(record) {
        delete record.nodeSha256;
      },
      expected: /identity or handoff contract is invalid/,
    },
    {
      name: "runtime escape",
      mutate(record, value) {
        const outsidePath = path.join(value.root, "outside-node");
        writeFileSync(outsidePath, "outside runtime\n", { mode: 0o500 });
        record.nodePath = outsidePath;
        record.nodeSha256 = createHash("sha256")
          .update(readFileSync(outsidePath))
          .digest("hex");
      },
      expected: /identity or handoff contract is invalid/,
    },
    {
      name: "mixed runtime versions",
      mutate(record, value) {
        const differentRuntimePath = path.join(
          value.runtimeRoot,
          "2".repeat(64),
          "automation-control.mjs",
        );
        mkdirSync(path.dirname(differentRuntimePath), {
          recursive: true,
          mode: 0o700,
        });
        writeFileSync(differentRuntimePath, "different runtime\n", {
          mode: 0o500,
        });
        record.controlEntryPath = differentRuntimePath;
        record.controlEntrySha256 = createHash("sha256")
          .update(readFileSync(differentRuntimePath))
          .digest("hex");
      },
      expected: /identity or handoff contract is invalid/,
    },
    {
      name: "writable file",
      mutate(record) {
        chmodSync(record.controlEntryPath, 0o722);
      },
      expected: /not a root-owned immutable regular file/,
    },
    {
      name: "digest drift",
      mutate(record) {
        record.controlLibrarySha256 = "0".repeat(64);
      },
      expected: /identity or handoff contract is invalid/,
    },
  ];

  for (const scenario of cases) {
    const value = fixture();
    writeCredential(value);
    const credential = actorCredentialReadiness(value.stateRoot, value.spec.id);
    const { recordPath } = writeLauncherRecord(value);
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    scenario.mutate(record, value);
    writeFileSync(recordPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });

    const readiness = actorLauncherReadiness(value.stateRoot, value.spec.id, {
      credential,
      leaseContract: value.spec.lease,
      launcherRecordRoot: value.launcherRecordRoot,
      launcherRecordInspector: () => ({ ready: true, reason: "" }),
      launcherInspector: () => ({ ready: true, reason: "" }),
      runtimeRoot: value.runtimeRoot,
      runtimeFileInspector: (runtimePath, runtimeRoot) =>
        inspectRootOwnedRuntimeFile(runtimePath, runtimeRoot, {
          requiredUid:
            typeof process.getuid === "function" ? process.getuid() : 0,
        }),
    });
    assert.equal(readiness.ready, false, scenario.name);
    assert.match(readiness.reason, scenario.expected, scenario.name);
  }
});

test("runtime file inspection requires a regular immutable file owned by the trusted uid", () => {
  const value = fixture();
  writeCredential(value);
  const { recordPath } = writeLauncherRecord(value);
  const runtimePath = JSON.parse(readFileSync(recordPath, "utf8")).nodePath;
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : 0;

  assert.equal(
    inspectRootOwnedRuntimeFile(runtimePath, value.runtimeRoot, {
      requiredUid: currentUid,
    }).ready,
    true,
  );
  assert.match(
    inspectRootOwnedRuntimeFile(runtimePath, value.runtimeRoot, {
      requiredUid: currentUid + 1,
    }).reason,
    /not a root-owned immutable regular file/,
  );
  assert.match(
    inspectRootOwnedRuntimeFile(path.dirname(runtimePath), value.runtimeRoot, {
      requiredUid: currentUid,
    }).reason,
    /not a root-owned immutable regular file/,
  );
});

test("active actor rejects a launcher attestation that does not verify the credential", () => {
  const value = fixture();
  writeSavedAutomation(value, { status: "ACTIVE" });
  writeCredential(value);
  writeLauncherRecord(value, {
    attestationOverrides: { credentialDigestVerified: false },
  });
  const result = audit(value, {
    launcherInspector: () => ({ ready: true, reason: "" }),
  });

  assert.equal(result.records[0].handoffReady, false);
  assert.match(
    result.records[0].launcher.reason,
    /does not match the actor handoff contract/,
  );
  assert.ok(
    result.records[0].issues.some(
      (item) => item.code === "active-without-trusted-handoff",
    ),
  );
});

test("active actor fails closed on bounded timeout and malformed launcher output", () => {
  for (const scenario of ["timeout", "malformed"]) {
    const value = fixture();
    writeSavedAutomation(value, { status: "ACTIVE" });
    writeCredential(value);
    writeLauncherRecord(value);
    const result = audit(value, {
      launcherInspector: () => ({ ready: true, reason: "" }),
      launcherAttestor:
        scenario === "timeout"
          ? (_request, { timeoutMs }) => ({
              ready: false,
              reason: `trusted launcher readiness attestation exceeded ${timeoutMs.toLocaleString()} ms`,
            })
          : (request) => ({
              ready: true,
              reason: "",
              attestation: {
                ...launcherAttestation(value),
                actor: request.actor,
                unexpected: true,
              },
            }),
    });
    assert.equal(result.records[0].handoffReady, false, scenario);
    assert.match(
      result.records[0].launcher.reason,
      scenario === "timeout" ? /5,000 ms/ : /does not match/,
      scenario,
    );
  }
});

test("launcher attestation is bound to actor, state root, lease, lifetime, and digest", () => {
  const cases = [
    { actor: "different-actor" },
    { stateRoot: "/tmp/different-state" },
    { leaseName: "different-lease" },
    { maxLeaseLifetimeMs: 1_800_001 },
    { credentialSha256: "b".repeat(64) },
    { canonicalLeaseReady: false },
    { mutatesState: true },
  ];
  for (const attestationOverrides of cases) {
    const value = fixture();
    writeSavedAutomation(value, { status: "ACTIVE" });
    writeCredential(value);
    writeLauncherRecord(value);
    const result = audit(value, {
      launcherInspector: () => ({ ready: true, reason: "" }),
      launcherAttestor: () => ({
        ready: true,
        reason: "",
        attestation: launcherAttestation(value, attestationOverrides),
      }),
    });
    assert.equal(result.records[0].handoffReady, false);
    assert.match(
      result.records[0].launcher.reason,
      /does not match the actor handoff contract/,
    );
  }
});

test("model catalog accepts only advertised callable models and their reasoning efforts", () => {
  const fixtureCatalog = modelCatalog(["low", "high"]);
  fixtureCatalog.models.push({
    slug: "gpt-hidden-guess",
    visibility: "hide",
    supported_reasoning_levels: [{ effort: "high" }],
  });
  const catalog = authoritativeModelCatalog("/tmp/codex", fixtureCatalog, {
    nowMs: NOW_MS,
  });
  assert.equal(catalog.ready, true);
  assert.deepEqual([...catalog.models.keys()], ["gpt-5.6-sol"]);
  assert.deepEqual([...catalog.models.get("gpt-5.6-sol")].sort(), [
    "high",
    "low",
  ]);
});

test("model catalog rejects stale and future snapshots", () => {
  const stale = modelCatalog();
  stale.fetched_at = "2026-07-09T20:04:59.999Z";
  assert.match(
    authoritativeModelCatalog("/tmp/codex", stale, { nowMs: NOW_MS }).reason,
    /older than/,
  );

  const future = modelCatalog();
  future.fetched_at = "2026-07-10T20:10:00.001Z";
  assert.match(
    authoritativeModelCatalog("/tmp/codex", future, { nowMs: NOW_MS }).reason,
    /future-dated/,
  );
});
