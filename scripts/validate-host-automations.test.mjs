import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  actorLauncherReadiness,
  auditSavedAutomations,
  authoritativeModelCatalog,
  formatHostAutomationAudit,
  inspectRootOwnedRuntimeFile,
  parseSavedAutomationToml,
  readProjectRegistrySnapshot,
  validateSavedSchedule,
} from "./validate-host-automations.mjs";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const NOW_MS = Date.parse("2026-07-10T20:05:00.000Z");

function localProjectId(projectRoot) {
  return `local-${createHash("sha256")
    .update(projectRoot, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

const LOCAL_PROJECT_ID = localProjectId(sourceRoot);

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
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  chmodSync(stateRoot, 0o700);
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
    requiredHostCapabilities: ["trusted-launcher", "short-lived-lease-handoff"],
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

function writeProjectRegistry(
  value,
  {
    projectId = LOCAL_PROJECT_ID,
    project = {
      id: projectId,
      name: "freed",
      rootPaths: [sourceRoot],
    },
  } = {},
) {
  mkdirSync(value.codexHome, { recursive: true });
  const registryPath = path.join(value.codexHome, ".codex-global-state.json");
  writeFileSync(
    registryPath,
    `${JSON.stringify({ "local-projects": { [projectId]: project } })}\n`,
  );
  return registryPath;
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
      .map(([field, savedValue]) => `${field} = ${JSON.stringify(savedValue)}`)
      .join("\n") + "\n",
  );
  return value;
}

function launcherAttestation(value, overrides = {}) {
  const recordPath = path.join(
    value.launcherRecordRoot,
    `${value.spec.id}.json`,
  );
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  return {
    schemaVersion: 1,
    protocol: "freed-actor-launcher-readiness-v3",
    purpose: "automation-actor-launcher-readiness",
    actor: value.spec.id,
    stateRoot: realpathSync(value.stateRoot),
    leaseName: value.spec.lease.name,
    maxLeaseLifetimeMs: value.spec.lease.maxLifetimeMs,
    handoff: "trusted-launcher-channel-to-canonical-lease",
    channelProtocol: "freed-actor-launcher-channel-v1",
    launcherSha256: record.launcherSha256,
    runtimeDigest: path.basename(path.dirname(record.nodePath)),
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
    bindingOverrides = {},
    runtimeDigestOverrides = {},
    runtimePathOverrides = {},
  } = {},
) {
  value.launcherAttestationOverrides = attestationOverrides;
  const launcherContents = "#!/bin/sh\nexit 0\n";
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
    actorControlEntryPath: "pinned actor control entry fixture\n",
    controlLibraryPath: "pinned control library fixture\n",
    kernelGuardContractPath: "pinned kernel guard contract fixture\n",
    outcomeLedgerRepairContractPath:
      "pinned outcome ledger repair contract fixture\n",
    leaseArchiveHelperPath: "pinned lease archive helper fixture\n",
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
        "freed-automation-actor-runtime-v3",
        `node:${runtimeDigests.nodeSha256}`,
        `automation-control.mjs:${runtimeDigests.controlEntrySha256}`,
        `automation-actor-control.mjs:${runtimeDigests.actorControlEntrySha256}`,
        `lib/automation-control.mjs:${runtimeDigests.controlLibrarySha256}`,
        `lib/automation-kernel-guard-contract.mjs:${runtimeDigests.kernelGuardContractSha256}`,
        `lib/outcome-ledger-repair-contract.mjs:${runtimeDigests.outcomeLedgerRepairContractSha256}`,
        `lib/lease-archive-move.py:${runtimeDigests.leaseArchiveHelperSha256}`,
        "",
      ].join("\n"),
    )
    .digest("hex");
  const runtimeVersionRoot = path.join(value.runtimeRoot, runtimeDigest);
  const runtimePaths = {
    nodePath: path.join(runtimeVersionRoot, "node"),
    controlEntryPath: path.join(runtimeVersionRoot, "automation-control.mjs"),
    actorControlEntryPath: path.join(
      runtimeVersionRoot,
      "automation-actor-control.mjs",
    ),
    controlLibraryPath: path.join(
      runtimeVersionRoot,
      "lib",
      "automation-control.mjs",
    ),
    kernelGuardContractPath: path.join(
      runtimeVersionRoot,
      "lib",
      "automation-kernel-guard-contract.mjs",
    ),
    outcomeLedgerRepairContractPath: path.join(
      runtimeVersionRoot,
      "lib",
      "outcome-ledger-repair-contract.mjs",
    ),
    leaseArchiveHelperPath: path.join(
      runtimeVersionRoot,
      "lib",
      "lease-archive-move.py",
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
      schemaVersion: 3,
      actor: value.spec.id,
      purpose: "automation-actor-launcher",
      handoff: "trusted-launcher-channel-to-canonical-lease",
      attestationProtocol: "freed-actor-launcher-readiness-v3",
      launcherPath,
      launcherSha256,
      ...runtimePaths,
      ...runtimeDigests,
      ...runtimeDigestOverrides,
      stateRoot: realpathSync(value.stateRoot),
      leaseName: value.spec.lease.name,
      maxLeaseLifetimeMs: value.spec.lease.maxLifetimeMs,
      ...bindingOverrides,
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
    launcherAttestor: () => ({
      ready: true,
      reason: "",
      attestation: launcherAttestation(
        value,
        value.launcherAttestationOverrides,
      ),
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

test("cron actors accept a registered local project id bound to the canonical cwd", () => {
  const value = fixture();
  writeProjectRegistry(value);
  writeSavedAutomation(value, {
    target: { type: "project", project_id: LOCAL_PROJECT_ID },
  });

  const result = audit(value);
  assert.equal(result.issueCount, 0);
});

test("local project ids fail closed when the current registry is unavailable", () => {
  const value = fixture();
  writeSavedAutomation(value, {
    target: { type: "project", project_id: LOCAL_PROJECT_ID },
  });

  assert.deepEqual(audit(value).records[0].issues, [
    {
      code: "target-drift",
      message: "target project registry cannot be read",
    },
  ]);
});

test("unknown local project ids fail closed even with the canonical cwd", () => {
  const value = fixture();
  writeProjectRegistry(value, {
    projectId: `local-${"b".repeat(32)}`,
  });
  writeSavedAutomation(value, {
    target: { type: "project", project_id: LOCAL_PROJECT_ID },
  });

  assert.deepEqual(audit(value).records[0].issues, [
    {
      code: "target-drift",
      message: "target project id is not registered to one absolute root",
    },
  ]);
});

test("selected project hints cannot replace the current local project registry", () => {
  for (const localProjects of [undefined, {}]) {
    const value = fixture();
    mkdirSync(value.codexHome, { recursive: true });
    writeFileSync(
      path.join(value.codexHome, ".codex-global-state.json"),
      `${JSON.stringify({
        ...(localProjects === undefined
          ? {}
          : { "local-projects": localProjects }),
        "selected-project": {
          type: "local",
          projectId: LOCAL_PROJECT_ID,
        },
      })}\n`,
    );
    writeSavedAutomation(value, {
      target: { type: "project", project_id: LOCAL_PROJECT_ID },
    });

    assert.deepEqual(audit(value).records[0].issues, [
      {
        code: "target-drift",
        message: "target project id is not registered to one absolute root",
      },
    ]);
  }
});

test("local project ids ignore backup state when the current registry is malformed", () => {
  const value = fixture();
  mkdirSync(value.codexHome, { recursive: true });
  writeFileSync(
    path.join(value.codexHome, ".codex-global-state.json"),
    "{not-json\n",
  );
  writeFileSync(
    path.join(value.codexHome, ".codex-global-state.json.bak"),
    `${JSON.stringify({
      "local-projects": {
        [LOCAL_PROJECT_ID]: {
          id: LOCAL_PROJECT_ID,
          rootPaths: [sourceRoot],
        },
      },
    })}\n`,
  );
  writeSavedAutomation(value, {
    target: { type: "project", project_id: LOCAL_PROJECT_ID },
  });

  assert.deepEqual(audit(value).records[0].issues, [
    {
      code: "target-drift",
      message: "target project registry cannot be read",
    },
  ]);
});

test("local project ids reject a symlink in place of the current registry", () => {
  const value = fixture();
  mkdirSync(value.codexHome, { recursive: true });
  const registryTarget = path.join(
    value.codexHome,
    ".codex-global-state.actual.json",
  );
  writeFileSync(
    registryTarget,
    `${JSON.stringify({
      "local-projects": {
        [LOCAL_PROJECT_ID]: {
          id: LOCAL_PROJECT_ID,
          rootPaths: [sourceRoot],
        },
      },
    })}\n`,
  );
  symlinkSync(
    registryTarget,
    path.join(value.codexHome, ".codex-global-state.json"),
  );
  writeSavedAutomation(value, {
    target: { type: "project", project_id: LOCAL_PROJECT_ID },
  });

  assert.deepEqual(audit(value).records[0].issues, [
    {
      code: "target-drift",
      message: "target project registry cannot be read",
    },
  ]);
});

test("local project ids reject unsafe or unbounded current registry files", () => {
  for (const scenario of ["empty", "writable", "oversized"]) {
    const value = fixture();
    const registryPath = writeProjectRegistry(value);
    if (scenario === "empty") writeFileSync(registryPath, "");
    if (scenario === "writable") chmodSync(registryPath, 0o666);
    if (scenario === "oversized") {
      truncateSync(registryPath, 16 * 1_024 * 1_024 + 1);
    }
    writeSavedAutomation(value, {
      target: { type: "project", project_id: LOCAL_PROJECT_ID },
    });

    assert.deepEqual(audit(value).records[0].issues, [
      {
        code: "target-drift",
        message: "target project registry cannot be read",
      },
    ]);
  }
});

test("bounded project registry reads reject growth after the size snapshot", () => {
  const value = fixture();
  const registryPath = writeProjectRegistry(value);
  const descriptor = openSync(
    registryPath,
    fsConstants.O_RDONLY | fsConstants.O_NONBLOCK,
  );
  try {
    const snapshotSize = fstatSync(descriptor).size;
    const growthReader = (fd, buffer, offset, length, position) => {
      if (position === snapshotSize) {
        buffer[offset] = 0x20;
        return 1;
      }
      return readSync(fd, buffer, offset, length, position);
    };
    assert.throws(
      () =>
        readProjectRegistrySnapshot(descriptor, snapshotSize, {
          reader: growthReader,
        }),
      /changed during its bounded read/,
    );
  } finally {
    closeSync(descriptor);
  }
});

test("bounded project registry reads handle partial reads before probing growth", () => {
  const value = fixture();
  const registryPath = writeProjectRegistry(value);
  const expected = readFileSync(registryPath, "utf8");
  const descriptor = openSync(
    registryPath,
    fsConstants.O_RDONLY | fsConstants.O_NONBLOCK,
  );
  const partialReader = (fd, buffer, offset, length, position) =>
    readSync(fd, buffer, offset, Math.min(length, 7), position);
  try {
    const snapshotSize = fstatSync(descriptor).size;
    assert.equal(
      readProjectRegistrySnapshot(descriptor, snapshotSize, {
        reader: partialReader,
      }),
      expected,
    );
    const partialGrowthReader = (fd, buffer, offset, length, position) => {
      if (position === snapshotSize) {
        buffer[offset] = 0x20;
        return 1;
      }
      return partialReader(fd, buffer, offset, length, position);
    };
    assert.throws(
      () =>
        readProjectRegistrySnapshot(descriptor, snapshotSize, {
          reader: partialGrowthReader,
        }),
      /changed during its bounded read/,
    );
  } finally {
    closeSync(descriptor);
  }
});

test("local project ids reject a FIFO registry without blocking", () => {
  const value = fixture();
  mkdirSync(value.codexHome, { recursive: true });
  const registryPath = path.join(value.codexHome, ".codex-global-state.json");
  execFileSync("/usr/bin/mkfifo", [registryPath]);
  writeSavedAutomation(value, {
    target: { type: "project", project_id: LOCAL_PROJECT_ID },
  });
  const probePath = path.join(value.root, "fifo-registry-probe.mjs");
  writeFileSync(
    probePath,
    `import { auditSavedAutomations } from ${JSON.stringify(new URL("./validate-host-automations.mjs", import.meta.url).href)};
const result = auditSavedAutomations(${JSON.stringify({
      specs: [value.spec],
      repoRoot: value.repoRoot,
      codexHome: value.codexHome,
      stateRoot: value.stateRoot,
      launcherRecordRoot: value.launcherRecordRoot,
      runtimeRoot: value.runtimeRoot,
      modelCatalog: modelCatalog(),
      nowMs: NOW_MS,
    })});
const issue = result.records[0]?.issues[0];
if (result.issueCount !== 1 || issue?.code !== "target-drift" || issue?.message !== "target project registry cannot be read") process.exit(1);
`,
  );

  assert.doesNotThrow(() =>
    execFileSync(process.execPath, [probePath], {
      stdio: "pipe",
      timeout: 2_000,
    }),
  );
});

test("local project ids fail closed when the registry does not bind one absolute root", () => {
  const cases = [
    null,
    { id: `local-${"b".repeat(32)}`, rootPaths: [sourceRoot] },
    { id: LOCAL_PROJECT_ID, rootPaths: [] },
    { id: LOCAL_PROJECT_ID, rootPaths: [sourceRoot, sourceRoot] },
    { id: LOCAL_PROJECT_ID, rootPaths: ["relative/freed"] },
  ];
  for (const project of cases) {
    const value = fixture();
    writeProjectRegistry(value, { project });
    writeSavedAutomation(value, {
      target: { type: "project", project_id: LOCAL_PROJECT_ID },
    });

    assert.deepEqual(audit(value).records[0].issues, [
      {
        code: "target-drift",
        message: "target project id is not registered to one absolute root",
      },
    ]);
  }
});

test("registered local project ids still require the matching canonical cwd", () => {
  const value = fixture();
  writeProjectRegistry(value);
  writeSavedAutomation(value, {
    target: { type: "project", project_id: LOCAL_PROJECT_ID },
    cwds: ["/tmp"],
  });

  assert.deepEqual(audit(value).records[0].issues, [
    {
      code: "cwds-drift",
      message: "cwds does not match the registered target project root",
    },
  ]);
});

test("registered local project ids retain canonical Git identity checks", () => {
  const value = fixture();
  const notFreed = path.join(value.root, "not-freed");
  mkdirSync(notFreed);
  const notFreedProjectId = localProjectId(notFreed);
  writeProjectRegistry(value, {
    projectId: notFreedProjectId,
    project: {
      id: notFreedProjectId,
      name: "not-freed",
      rootPaths: [notFreed],
    },
  });
  writeSavedAutomation(value, {
    target: { type: "project", project_id: notFreedProjectId },
    cwds: [notFreed],
  });

  assert.deepEqual(audit(value).records[0].issues, [
    {
      code: "target-drift",
      message: "target project Git identity cannot be verified",
    },
  ]);
});

test("registered local project ids must match the canonical cwd digest", () => {
  const value = fixture();
  const forgedProjectId = `local-${"b".repeat(32)}`;
  writeProjectRegistry(value, {
    projectId: forgedProjectId,
    project: {
      id: forgedProjectId,
      rootPaths: [sourceRoot],
    },
  });
  writeSavedAutomation(value, {
    target: { type: "project", project_id: forgedProjectId },
  });

  assert.deepEqual(audit(value).records[0].issues, [
    {
      code: "target-drift",
      message: "target project id does not match its registered root",
    },
  ]);
});

test("registered local project roots must have one project claimant", () => {
  const value = fixture();
  const duplicateId = `local-${"c".repeat(32)}`;
  mkdirSync(value.codexHome, { recursive: true });
  writeFileSync(
    path.join(value.codexHome, ".codex-global-state.json"),
    `${JSON.stringify({
      "local-projects": {
        [LOCAL_PROJECT_ID]: {
          id: LOCAL_PROJECT_ID,
          rootPaths: [sourceRoot],
        },
        [duplicateId]: {
          id: duplicateId,
          rootPaths: [sourceRoot],
        },
      },
    })}\n`,
  );
  writeSavedAutomation(value, {
    target: { type: "project", project_id: LOCAL_PROJECT_ID },
  });

  assert.deepEqual(audit(value).records[0].issues, [
    {
      code: "target-drift",
      message: "target project root is not uniquely registered",
    },
  ]);
});

test("registered local project roots reject a physical alias claimant", () => {
  const value = fixture();
  const aliasRoot = path.join(value.root, "freed-alias");
  const aliasId = localProjectId(aliasRoot);
  symlinkSync(sourceRoot, aliasRoot);
  mkdirSync(value.codexHome, { recursive: true });
  writeFileSync(
    path.join(value.codexHome, ".codex-global-state.json"),
    `${JSON.stringify({
      "local-projects": {
        [LOCAL_PROJECT_ID]: {
          id: LOCAL_PROJECT_ID,
          rootPaths: [sourceRoot],
        },
        [aliasId]: {
          id: aliasId,
          rootPaths: [aliasRoot],
        },
      },
    })}\n`,
  );
  writeSavedAutomation(value, {
    target: { type: "project", project_id: LOCAL_PROJECT_ID },
  });

  assert.deepEqual(audit(value).records[0].issues, [
    {
      code: "target-drift",
      message: "target project root is not uniquely registered",
    },
  ]);
});

test("registered local project roots ignore a missing unrelated project", () => {
  const value = fixture();
  const staleRoot = path.join(value.root, "deleted-project");
  const staleId = localProjectId(staleRoot);
  mkdirSync(value.codexHome, { recursive: true });
  writeFileSync(
    path.join(value.codexHome, ".codex-global-state.json"),
    `${JSON.stringify({
      "local-projects": {
        [LOCAL_PROJECT_ID]: {
          id: LOCAL_PROJECT_ID,
          rootPaths: [sourceRoot],
        },
        [staleId]: {
          id: staleId,
          rootPaths: [staleRoot],
        },
      },
    })}\n`,
  );
  writeSavedAutomation(value, {
    target: { type: "project", project_id: LOCAL_PROJECT_ID },
  });

  assert.equal(audit(value).issueCount, 0);
});

test("opaque project references outside the current local id format are rejected", () => {
  const value = fixture();
  writeProjectRegistry(value, { projectId: "project-freed" });
  writeSavedAutomation(value, {
    target: { type: "project", project_id: "project-freed" },
  });

  assert.deepEqual(audit(value).records[0].issues, [
    {
      code: "target-drift",
      message: "target project id is not a supported local project reference",
    },
  ]);
});

test("paused actor may await its owner-installed launcher", () => {
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
  writeLauncherRecord(value);
  const result = audit(value, {
    launcherInspector: () => ({ ready: true, reason: "" }),
  });

  assert.equal(result.issueCount, 0);
  assert.equal(result.records[0].handoffReady, true);
  assert.match(formatHostAutomationAudit(result), /\[ok\].*ACTIVE/);
});

test("active actor rejects an exact-digest legacy protocol before attestation", () => {
  const value = fixture();
  writeSavedAutomation(value, { status: "ACTIVE" });
  const { launcherPath, recordPath } = writeLauncherRecord(value, {
    bindingOverrides: {
      attestationProtocol: "freed-actor-launcher-readiness-v1",
    },
  });
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  assert.equal(
    createHash("sha256").update(readFileSync(launcherPath)).digest("hex"),
    record.launcherSha256,
  );
  let attestationCalls = 0;
  const result = audit(value, {
    launcherInspector: () => ({ ready: true, reason: "" }),
    launcherAttestor: () => {
      attestationCalls += 1;
      throw new Error("legacy protocol must fail before attestation");
    },
  });

  assert.deepEqual(
    result.records[0].issues.map((item) => item.code),
    ["active-without-trusted-handoff"],
  );
  assert.equal(result.records[0].handoffReady, false);
  assert.match(
    result.records[0].launcher.reason,
    /handoff contract is invalid/,
  );
  assert.equal(attestationCalls, 0);
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

test("launcher records reject digest drift and an untrusted binding record", () => {
  const value = fixture();
  const launcher = writeLauncherRecord(value, { digest: "0".repeat(64) });
  const readiness = actorLauncherReadiness(value.stateRoot, value.spec.id, {
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

test("paused validation ignores an obsolete actor record symlink", () => {
  const value = fixture();
  writeSavedAutomation(value);
  const obsoleteRecordRoot = path.join(
    value.stateRoot,
    "control",
    "actor-credentials",
  );
  mkdirSync(obsoleteRecordRoot, { recursive: true, mode: 0o700 });
  const targetPath = path.join(value.root, "obsolete-record-target.json");
  writeFileSync(targetPath, "not json\n");
  symlinkSync(
    targetPath,
    path.join(obsoleteRecordRoot, `${value.spec.id}.json`),
  );

  const result = audit(value);
  assert.equal(result.issueCount, 0);
  assert.equal(result.records[0].handoffReady, false);
  assert.equal(Object.hasOwn(result.records[0], "credential"), false);
  assert.match(result.records[0].launcher.reason, /launcher record is missing/);
});

test("general actor launcher records pin the complete root-owned runtime", () => {
  const value = fixture();
  const { recordPath } = writeLauncherRecord(value);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));

  for (const field of [
    "nodePath",
    "nodeSha256",
    "controlEntryPath",
    "controlEntrySha256",
    "actorControlEntryPath",
    "actorControlEntrySha256",
    "controlLibraryPath",
    "controlLibrarySha256",
    "kernelGuardContractPath",
    "kernelGuardContractSha256",
    "outcomeLedgerRepairContractPath",
    "outcomeLedgerRepairContractSha256",
    "leaseArchiveHelperPath",
    "leaseArchiveHelperSha256",
  ]) {
    assert.equal(Object.hasOwn(record, field), true, `${field} is missing`);
  }

  const readiness = actorLauncherReadiness(value.stateRoot, value.spec.id, {
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
  assert.equal(readiness.actorControlEntryPath, record.actorControlEntryPath);
  assert.equal(readiness.controlLibraryPath, record.controlLibraryPath);
  assert.equal(
    readiness.kernelGuardContractPath,
    record.kernelGuardContractPath,
  );
  assert.equal(
    readiness.outcomeLedgerRepairContractPath,
    record.outcomeLedgerRepairContractPath,
  );
  assert.equal(
    readiness.leaseArchiveHelperPath,
    record.leaseArchiveHelperPath,
  );
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
      name: "lease archive helper escape",
      mutate(record, value) {
        const outsidePath = path.join(value.root, "outside-archive-helper.py");
        writeFileSync(outsidePath, "print('outside runtime')\n", {
          mode: 0o400,
        });
        record.leaseArchiveHelperPath = outsidePath;
        record.leaseArchiveHelperSha256 = createHash("sha256")
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
    {
      name: "lease archive helper digest drift",
      mutate(record) {
        record.leaseArchiveHelperSha256 = "0".repeat(64);
      },
      expected: /identity or handoff contract is invalid/,
    },
    {
      name: "kernel guard contract digest drift",
      mutate(record) {
        record.kernelGuardContractSha256 = "0".repeat(64);
      },
      expected: /identity or handoff contract is invalid/,
    },
    {
      name: "outcome ledger repair contract special mode",
      mutate(record) {
        chmodSync(record.outcomeLedgerRepairContractPath, 0o4600);
      },
      expected: /not a root-owned immutable regular file/,
    },
    {
      name: "lease archive helper special mode",
      mutate(record) {
        chmodSync(record.leaseArchiveHelperPath, 0o4600);
      },
      expected: /not a root-owned immutable regular file/,
    },
  ];

  for (const scenario of cases) {
    const value = fixture();
    const { recordPath } = writeLauncherRecord(value);
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    scenario.mutate(record, value);
    writeFileSync(recordPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });

    const readiness = actorLauncherReadiness(value.stateRoot, value.spec.id, {
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

test("active actor rejects a launcher attestation with the wrong channel protocol", () => {
  const value = fixture();
  writeSavedAutomation(value, { status: "ACTIVE" });
  writeLauncherRecord(value, {
    attestationOverrides: { channelProtocol: "untrusted-channel" },
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
      scenario === "timeout" ? /15,000 ms/ : /does not match/,
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
    { channelProtocol: "different-channel" },
    { launcherSha256: "b".repeat(64) },
    { runtimeDigest: "c".repeat(64) },
    { canonicalLeaseReady: false },
    { mutatesState: true },
  ];
  for (const attestationOverrides of cases) {
    const value = fixture();
    writeSavedAutomation(value, { status: "ACTIVE" });
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
