import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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
  { digest = undefined, attestationOverrides = {} } = {},
) {
  const attestation = launcherAttestation(value, attestationOverrides);
  const launcherPath = path.join(value.root, "trusted-launcher");
  writeFileSync(
    launcherPath,
    `#!/bin/sh\nprintf '%s\\n' ${shellQuote(JSON.stringify(attestation))}\n`,
    { mode: 0o700 },
  );
  const launcherSha256 =
    digest ??
    createHash("sha256").update(readFileSync(launcherPath)).digest("hex");
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
  writeFileSync(
    path.join(automationDir, "automation.toml"),
    [
      `id = ${JSON.stringify(value.spec.id)}`,
      `kind = ${JSON.stringify(value.spec.kind)}`,
      `name = ${JSON.stringify(value.spec.name)}`,
      `prompt = ${JSON.stringify("# Nightly\n\nUse the governed task queue.")}`,
      'status = "PAUSED"',
      'rrule = "FREQ=MINUTELY;INTERVAL=30"',
      'destination = "thread"',
      'target_thread_id = "thread-123"',
      "",
    ].join("\n"),
  );
  const result = audit(value);
  assert.equal(result.issueCount, 0);
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
    keychainLookup: () => ({ ready: true, reason: "" }),
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
    keychainLookup: () => ({ ready: true, reason: "" }),
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

test("active actor rejects a launcher attestation that does not verify the credential", () => {
  const value = fixture();
  writeSavedAutomation(value, { status: "ACTIVE" });
  writeCredential(value);
  writeLauncherRecord(value, {
    attestationOverrides: { credentialDigestVerified: false },
  });
  const result = audit(value, {
    launcherInspector: () => ({ ready: true, reason: "" }),
    keychainLookup: () => ({ ready: true, reason: "" }),
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
      keychainLookup: () => ({ ready: true, reason: "" }),
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
