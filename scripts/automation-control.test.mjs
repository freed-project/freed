import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign as signPayload,
} from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  AutomationControlError,
  AUTOMATION_ACTOR_POLICIES,
  OBSERVER_AUTHORITIES,
  TASK_STATES,
  acquireLease,
  appendControlEvent,
  automationControlPaths,
  bindPublisherLeaseHead,
  createTask,
  finalizeTaskOutcome,
  guardOwnerIsLive,
  heartbeatLease,
  inspectLease,
  isTaskTransitionAllowed,
  ownerGovernanceIntentDigest,
  processStartIdentity,
  readTask,
  readTaskManifest,
  releaseLease,
  resolveAutomationStateRoot,
  transitionTask,
  updateTaskAuthorities,
  verifyOwnerCapabilityEnvelope,
} from "./lib/automation-control.mjs";
import {
  providerApprovalAuthorizationDigest,
  validateProviderRiskApproval,
} from "./lib/provider-visible-paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, "automation-control.mjs");

function temporaryStateRoot() {
  return realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-automation-control-")),
  );
}

function ownerIntent(action, taskId, parameters) {
  return ownerGovernanceIntentDigest({
    schemaVersion: 1,
    action,
    taskId,
    parameters,
  });
}

function signedOwnerCapability(
  stateRoot,
  taskId,
  intentDigest,
  leaseToken,
  {
    nowMs = Date.parse("2026-07-10T09:00:00Z"),
    ttlMs = 10 * 60_000,
    capabilityId = `owner-capability-${nowMs}`,
    privateKey = undefined,
  } = {},
) {
  const keyPair =
    privateKey === undefined ? generateKeyPairSync("ed25519") : { privateKey };
  const publicKey = createPublicKey(keyPair.privateKey);
  const publicKeyBase64 = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("base64");
  const payload = {
    schemaVersion: 1,
    capabilityId,
    issuer: "trusted-publisher-host",
    purpose: "owner-governance-capability",
    actor: "freed-owner",
    leaseName: "owner-governance",
    stateRoot: realpathSync(stateRoot),
    taskId,
    intentDigest,
    tokenSha256: createHash("sha256").update(leaseToken).digest("hex"),
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + 60_000).toISOString(),
    leaseTtlMs: ttlMs,
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  return {
    envelope: {
      schemaVersion: 1,
      payloadBase64: payloadBytes.toString("base64"),
      signatureBase64: signPayload(
        null,
        payloadBytes,
        keyPair.privateKey,
      ).toString("base64"),
    },
    payload,
    privateKey: keyPair.privateKey,
    publicKeyBase64,
  };
}

function writeActorCredential(
  stateRoot,
  actor,
  token = `${actor}-persistent-secret-1234567890`,
) {
  const credentialPath = path.join(
    automationControlPaths(stateRoot).actorCredentials,
    `${actor}.json`,
  );
  mkdirSync(path.dirname(credentialPath), { recursive: true });
  writeFileSync(
    credentialPath,
    `${JSON.stringify({
      schemaVersion: 1,
      actor,
      purpose: "automation-actor-lease",
      tokenSha256: createHash("sha256").update(token).digest("hex"),
    })}\n`,
    { mode: 0o600 },
  );
  return token;
}

function writePublisherCapability(
  stateRoot,
  scope,
  {
    nowMs = Date.now(),
    ttlMs = 30 * 60_000,
    lifetimeMs = 60_000,
    capabilityId = `publisher-capability-${nowMs}`,
    privateKey = undefined,
    payloadScope = scope,
  } = {},
) {
  const keyPair =
    privateKey === undefined ? generateKeyPairSync("ed25519") : { privateKey };
  const publicKey = keyPair.privateKey
    ? createPublicKey(keyPair.privateKey)
    : keyPair.publicKey;
  const rawPublicKey = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  const credentialPath = path.join(
    automationControlPaths(stateRoot).actorCredentials,
    "freed-pr-publisher.json",
  );
  mkdirSync(path.dirname(credentialPath), { recursive: true, mode: 0o700 });
  writeFileSync(
    credentialPath,
    `${JSON.stringify({
      schemaVersion: 1,
      actor: "freed-pr-publisher",
      purpose: "publisher-capability-signing",
      publicKeyBase64: rawPublicKey.toString("base64"),
    })}\n`,
    { mode: 0o600 },
  );
  const payload = {
    schemaVersion: 1,
    capabilityId,
    issuer: "freed-pr-publisher",
    leaseName: "pr-publisher",
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + lifetimeMs).toISOString(),
    leaseTtlMs: ttlMs,
    scope: payloadScope,
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const capabilityPath = path.join(
    automationControlPaths(stateRoot).publisherCapabilitiesPending,
    `${capabilityId}.json`,
  );
  mkdirSync(path.dirname(capabilityPath), { recursive: true, mode: 0o700 });
  writeFileSync(
    capabilityPath,
    `${JSON.stringify({
      schemaVersion: 1,
      payloadBase64: payloadBytes.toString("base64"),
      signatureBase64: signPayload(
        null,
        payloadBytes,
        keyPair.privateKey,
      ).toString("base64"),
    })}\n`,
    { mode: 0o600 },
  );
  return { capabilityId, capabilityPath, privateKey: keyPair.privateKey };
}

function writeLegacyLease(
  stateRoot,
  actor,
  { owner = actor, token = `${actor}-legacy-token`, nowMs = Date.now() } = {},
) {
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const leasePath = path.join(
    automationControlPaths(stateRoot).leases,
    `${policy.leaseName}.lease`,
  );
  mkdirSync(leasePath, { recursive: true, mode: 0o700 });
  const record = {
    schemaVersion: 1,
    name: policy.leaseName,
    owner,
    token,
    observerAuthority: policy.observerAuthority,
    providerAuthority: policy.providerAuthority,
    acquiredAt: new Date(nowMs - 60_000).toISOString(),
    heartbeatAt: new Date(nowMs - 30_000).toISOString(),
    expiresAt: new Date(nowMs + 60 * 60_000).toISOString(),
    ttlMs: 60 * 60_000,
  };
  writeFileSync(
    path.join(leasePath, "lease.json"),
    `${JSON.stringify(record)}\n`,
    {
      mode: 0o600,
    },
  );
  return { leasePath, policy, record };
}

function readEvents(stateRoot) {
  const eventsPath = automationControlPaths(stateRoot).events;
  return readFileSync(eventsPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function actorLease(
  stateRoot,
  actor,
  {
    nowMs = Date.now(),
    token = `${actor}-token`,
    ownerTaskId = undefined,
    ownerIntentDigest = undefined,
  } = {},
) {
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  assert.ok(policy, `missing actor policy for ${actor}`);
  if (actor === "freed-owner") {
    assert.match(ownerTaskId ?? "", /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
    assert.match(ownerIntentDigest ?? "", /^[0-9a-f]{64}$/);
    const leasePath = path.join(
      automationControlPaths(stateRoot).leases,
      `${policy.leaseName}.lease`,
    );
    mkdirSync(leasePath, { recursive: true, mode: 0o700 });
    writeFileSync(
      path.join(leasePath, "lease.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        name: policy.leaseName,
        owner: actor,
        token,
        observerAuthority: policy.observerAuthority,
        providerAuthority: policy.providerAuthority,
        credentialKind: "owner-signed-capability",
        ownerCapabilityId: `owner-test-${nowMs}`,
        ownerCapabilityTaskId: ownerTaskId,
        ownerCapabilityIntentDigest: ownerIntentDigest,
        acquiredAt: new Date(nowMs).toISOString(),
        heartbeatAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 10 * 60_000).toISOString(),
        ttlMs: 10 * 60_000,
      })}\n`,
      { mode: 0o600 },
    );
    return { actor, leaseName: policy.leaseName, leaseToken: token };
  }
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  acquireLease({
    stateRoot,
    name: policy.leaseName,
    owner: actor,
    ttlMs: 24 * 60 * 60 * 1_000,
    nowMs,
    token,
    actorCredentialToken,
  });
  return { actor, leaseName: policy.leaseName, leaseToken: token };
}

function runCli(args, { env = process.env } = {}) {
  return JSON.parse(
    execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: "utf8",
      env,
    }),
  );
}

function spawnCli(args, { env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test("state root defaults under the user automation directory and supports explicit roots", () => {
  assert.equal(
    resolveAutomationStateRoot(),
    path.join(os.homedir(), ".freed", "automation"),
  );
  const explicit = path.join(os.tmpdir(), "freed-control-explicit");
  assert.equal(resolveAutomationStateRoot(explicit), explicit);
  assert.equal(
    resolveAutomationStateRoot("~/.freed/automation-test"),
    path.join(os.homedir(), ".freed", "automation-test"),
  );
});

test("guard ownership uses PID start identity and only takes over a dead stale owner", () => {
  const identity = processStartIdentity(process.pid);
  const liveOwner = {
    schemaVersion: 1,
    owner: `${process.pid}:live-test`,
    pid: process.pid,
    processStartIdentity: identity,
    acquiredAt: new Date().toISOString(),
  };
  assert.equal(guardOwnerIsLive(liveOwner), true);
  if (identity !== null) {
    assert.equal(
      guardOwnerIsLive({
        ...liveOwner,
        processStartIdentity: `${identity}-reused`,
      }),
      false,
    );
  }
  assert.equal(
    guardOwnerIsLive({
      ...liveOwner,
      pid: 2_147_483_647,
      processStartIdentity: "dead",
    }),
    false,
  );

  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  const guardPath = path.join(paths.guards, "tasks.lock");
  mkdirSync(guardPath, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(guardPath, "owner.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      owner: "dead-owner",
      pid: 2_147_483_647,
      processStartIdentity: "dead",
      acquiredAt: "2026-07-10T00:00:00.000Z",
    })}\n`,
    { mode: 0o600 },
  );
  const staleAt = new Date(Date.now() - 60_000);
  utimesSync(guardPath, staleAt, staleAt);
  const manifest = readTaskManifest({ stateRoot, nowMs: Date.now() });
  assert.equal(manifest.revision, 0);
  assert.equal(existsSync(guardPath), false);
});

test("task mutations atomically replace one sorted current manifest and append versioned events", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  createTask({
    stateRoot,
    taskId: "P1-05",
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "approval-required",
    details: { behavioral: true, metricId: "novel-items-not-persisted" },
    nowMs: Date.parse("2026-07-10T10:00:00Z"),
  });
  createTask({
    stateRoot,
    taskId: "P0-01",
    ...controller,
    observerAuthority: "pr-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: Date.parse("2026-07-10T10:01:00Z"),
  });

  const transition = transitionTask({
    stateRoot,
    taskId: "P1-05",
    ...controller,
    toState: "triaged",
    expectedRevision: 1,
    nowMs: Date.parse("2026-07-10T10:02:00Z"),
  });

  assert.equal(transition.manifestRevision, 3);
  assert.equal(transition.task.revision, 2);
  assert.equal(transition.task.state, "triaged");
  const manifest = readTaskManifest({ stateRoot });
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.revision, 3);
  assert.deepEqual(
    manifest.tasks.map((task) => task.taskId),
    ["P0-01", "P1-05"],
  );
  assert.equal(manifest.tasks[1].observerAuthority, "plan-only");
  assert.equal(manifest.tasks[1].providerAuthority, "approval-required");

  const files = readdirSync(
    path.dirname(automationControlPaths(stateRoot).taskManifest),
  );
  assert.equal(
    files.some((name) => name.endsWith(".tmp")),
    false,
  );
  const events = readEvents(stateRoot);
  assert.deepEqual(
    events.map((event) => event.type),
    ["lease_acquired", "task_created", "task_created", "task_transitioned"],
  );
  assert.ok(
    events.every(
      (event) => event.schemaVersion === 1 && event.eventId && event.ts,
    ),
  );
});

test("a pending task transaction recovers manifest state and exactly one audit event", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  createTask({
    stateRoot,
    taskId: "recoverable-task",
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
  });

  const paths = automationControlPaths(stateRoot);
  const current = readTaskManifest({ stateRoot });
  const targetManifest = structuredClone(current);
  const targetTask = targetManifest.tasks[0];
  const transitionAt = "2026-07-10T10:05:00.000Z";
  targetTask.state = "triaged";
  targetTask.revision = 2;
  targetTask.updatedAt = transitionAt;
  targetManifest.revision = current.revision + 1;
  targetManifest.updatedAt = transitionAt;
  const event = {
    schemaVersion: 1,
    eventId: "recoverable-event",
    type: "task_transitioned",
    ts: transitionAt,
    actor: "freed-stability-controller",
    taskId: targetTask.taskId,
    taskRevision: targetTask.revision,
    manifestRevision: targetManifest.revision,
    observerAuthority: targetTask.observerAuthority,
    providerAuthority: targetTask.providerAuthority,
    data: { fromState: "observed", toState: "triaged" },
  };
  const transaction = {
    schemaVersion: 1,
    transactionId: "recoverable-transaction",
    preparedAt: transitionAt,
    previousManifestRevision: current.revision,
    targetManifest,
    event,
  };
  mkdirSync(paths.taskTransactions, { recursive: true });
  const transactionPath = path.join(
    paths.taskTransactions,
    "000000000002-recoverable.json",
  );
  writeFileSync(transactionPath, `${JSON.stringify(transaction, null, 2)}\n`);

  const recovered = readTaskManifest({ stateRoot });
  assert.equal(recovered.revision, 2);
  assert.equal(recovered.tasks[0].state, "triaged");
  assert.equal(
    readEvents(stateRoot).filter((item) => item.eventId === event.eventId)
      .length,
    1,
  );
  assert.equal(existsSync(transactionPath), false);

  writeFileSync(transactionPath, `${JSON.stringify(transaction, null, 2)}\n`);
  readTaskManifest({ stateRoot });
  assert.equal(
    readEvents(stateRoot).filter((item) => item.eventId === event.eventId)
      .length,
    1,
  );
  assert.equal(existsSync(transactionPath), false);
});

test("task creation and same-state transition retries are idempotent", () => {
  const stateRoot = temporaryStateRoot();
  const observer = actorLease(stateRoot, "freed-runtime-observer");
  const input = {
    stateRoot,
    taskId: "W1-01",
    ...observer,
    observerAuthority: "observe-only",
    providerAuthority: "forbidden",
    details: { behavioral: false, evidence: "digest-1" },
    nowMs: Date.parse("2026-07-10T11:00:00Z"),
  };
  const created = createTask(input);
  const retried = createTask(input);
  const transition = transitionTask({
    stateRoot,
    taskId: "W1-01",
    ...observer,
    toState: "observed",
    expectedRevision: 1,
  });

  assert.equal(created.changed, true);
  assert.equal(retried.changed, false);
  assert.equal(transition.changed, false);
  assert.equal(readTaskManifest({ stateRoot }).revision, 1);
  assert.equal(readEvents(stateRoot).length, 2);
});

test("task transitions reject skipped states and stale revisions", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const runner = actorLease(stateRoot, "freed-nightly-runner");
  createTask({
    stateRoot,
    taskId: "P0-02",
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: false },
  });

  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "P0-02",
        ...runner,
        toState: "implemented",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "invalid_transition",
  );
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "P0-02",
        ...controller,
        toState: "triaged",
        expectedRevision: 2,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "revision_conflict",
  );
  assert.equal(readTask({ stateRoot, taskId: "P0-02" }).state, "observed");
});

test("stored task authority is a lifecycle ceiling", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const scaffolding = actorLease(stateRoot, "freed-scaffolding-maintainer");
  const runner = actorLease(stateRoot, "freed-nightly-runner");

  createTask({
    stateRoot,
    taskId: "observe-ceiling",
    ...controller,
    observerAuthority: "observe-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "observe-ceiling",
        ...controller,
        toState: "triaged",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "task_authority_insufficient",
  );

  createTask({
    stateRoot,
    taskId: "plan-ceiling",
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
  });
  transitionTask({
    stateRoot,
    taskId: "plan-ceiling",
    ...controller,
    toState: "triaged",
  });
  transitionTask({
    stateRoot,
    taskId: "plan-ceiling",
    ...controller,
    toState: "approved_for_pr",
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "plan-ceiling",
        ...scaffolding,
        toState: "implemented",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "task_authority_insufficient",
  );

  createTask({
    stateRoot,
    taskId: "pr-ceiling",
    ...controller,
    observerAuthority: "pr-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
  });
  transitionTask({
    stateRoot,
    taskId: "pr-ceiling",
    ...controller,
    toState: "triaged",
  });
  transitionTask({
    stateRoot,
    taskId: "pr-ceiling",
    ...controller,
    toState: "approved_for_pr",
  });
  transitionTask({
    stateRoot,
    taskId: "pr-ceiling",
    ...scaffolding,
    toState: "implemented",
  });
  transitionTask({
    stateRoot,
    taskId: "pr-ceiling",
    ...scaffolding,
    toState: "validated",
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "pr-ceiling",
        ...runner,
        toState: "merged",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "task_authority_insufficient",
  );
});

test("task mutations require policy-bound leases and new tasks start observed", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");

  assert.throws(
    () =>
      createTask({
        stateRoot,
        taskId: "unsafe-terminal-create",
        ...controller,
        state: "merged",
        observerAuthority: "merge-safe",
        providerAuthority: "forbidden",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "invalid_initial_state",
  );
  assert.throws(
    () =>
      createTask({
        stateRoot,
        taskId: "missing-lease",
        actor: "freed-stability-controller",
        observerAuthority: "plan-only",
        providerAuthority: "forbidden",
        details: { behavioral: false },
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "invalid_identifier",
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "invented-writer",
        owner: "invented-actor",
        ttlMs: 1_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_not_authorized",
  );
});

test("actor policies enforce lifecycle ownership and fresh-evidence reopening", () => {
  const stateRoot = temporaryStateRoot();
  const observer = actorLease(stateRoot, "freed-runtime-observer");
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const scaffolding = actorLease(stateRoot, "freed-scaffolding-maintainer");
  const runner = actorLease(stateRoot, "freed-nightly-runner");
  const verifier = actorLease(stateRoot, "freed-release-verifier");

  createTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: Date.parse("2026-07-10T10:00:00Z"),
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "policy-lifecycle",
        ...observer,
        toState: "triaged",
        nowMs: Date.parse("2026-07-10T10:01:00Z"),
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_not_authorized",
  );
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...controller,
    toState: "triaged",
    nowMs: Date.parse("2026-07-10T10:01:00Z"),
  });
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...controller,
    toState: "approved_for_pr",
    nowMs: Date.parse("2026-07-10T10:02:00Z"),
  });
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...scaffolding,
    toState: "implemented",
    nowMs: Date.parse("2026-07-10T10:03:00Z"),
  });
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...scaffolding,
    toState: "validated",
    nowMs: Date.parse("2026-07-10T10:04:00Z"),
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "policy-lifecycle",
        ...scaffolding,
        toState: "merged",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_not_authorized",
  );
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...runner,
    toState: "merged",
    nowMs: Date.parse("2026-07-10T10:05:00Z"),
  });
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...runner,
    toState: "installed",
    details: {
      behavioral: false,
      installedIdentity: {
        version: "26.7.100-dev",
        commitSha: "1".repeat(40),
        channel: "dev",
      },
    },
    nowMs: Date.parse("2026-07-10T10:06:00Z"),
  });
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...runner,
    toState: "soaking",
    nowMs: Date.parse("2026-07-10T10:07:00Z"),
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "policy-lifecycle",
        ...runner,
        toState: "verified_effective",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_not_authorized",
  );
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "policy-lifecycle",
        ...verifier,
        toState: "verified_effective",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "outcome_record_required",
  );
  const verified = transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...verifier,
    toState: "verified_effective",
    details: {
      behavioral: false,
      latestOutcome: {
        outcome: "verified_effective",
        outcomeDigest: "a".repeat(64),
      },
    },
    nowMs: Date.parse("2026-07-10T10:08:00Z"),
  });
  assert.throws(
    () =>
      finalizeTaskOutcome({
        stateRoot,
        taskId: "policy-lifecycle",
        ...verifier,
        outcome: "verified_effective",
        outcomeDigest: "a".repeat(64),
        taskRevision: verified.task.revision,
        nowMs: Date.parse("2026-07-10T10:08:30Z"),
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "outcome_not_durable",
  );
  assert.ok(readTask({ stateRoot, taskId: "policy-lifecycle" }).pendingOutcome);

  createTask({
    stateRoot,
    taskId: "policy-reopen",
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: Date.parse("2026-07-10T10:08:30Z"),
  });
  transitionTask({
    stateRoot,
    taskId: "policy-reopen",
    ...controller,
    toState: "governance_blocked",
    nowMs: Date.parse("2026-07-10T10:08:40Z"),
  });
  transitionTask({
    stateRoot,
    taskId: "policy-reopen",
    ...controller,
    toState: "closed",
    nowMs: Date.parse("2026-07-10T10:09:00Z"),
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "policy-reopen",
        ...controller,
        toState: "triaged",
        details: { evidenceWindowEnd: "2026-07-10T10:08:59Z" },
        nowMs: Date.parse("2026-07-10T10:10:00Z"),
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "stale_reopen_evidence",
  );
  const reopened = transitionTask({
    stateRoot,
    taskId: "policy-reopen",
    ...controller,
    toState: "triaged",
    details: { evidenceWindowEnd: "2026-07-10T11:00:00Z" },
    nowMs: Date.parse("2026-07-10T11:01:00Z"),
  });
  assert.equal(reopened.task.state, "triaged");
});

test("provider-required tasks cannot enter implementation before owner authorization", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const runner = actorLease(stateRoot, "freed-nightly-runner");
  const owner = actorLease(stateRoot, "freed-owner", {
    ownerTaskId: "provider-change",
    ownerIntentDigest: ownerIntent("task.authorize", "provider-change", {
      observerAuthority: null,
      providerAuthority: "approved",
      reason: "Owner approved the exact provider diff.",
      approvalReference: "provider-risk-facebook-extractor",
      expectedRevision: null,
    }),
  });
  createTask({
    stateRoot,
    taskId: "provider-change",
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "approval-required",
    details: { behavioral: true },
  });
  transitionTask({
    stateRoot,
    taskId: "provider-change",
    ...controller,
    toState: "triaged",
  });
  transitionTask({
    stateRoot,
    taskId: "provider-change",
    ...controller,
    toState: "approved_for_pr",
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "provider-change",
        ...runner,
        toState: "implemented",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "provider_approval_required",
  );
  assert.throws(
    () =>
      updateTaskAuthorities({
        stateRoot,
        taskId: "provider-change",
        ...runner,
        providerAuthority: "approved",
        reason: "attempted self approval",
        approvalReference: "fake",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_not_authorized",
  );
  updateTaskAuthorities({
    stateRoot,
    taskId: "provider-change",
    ...owner,
    providerAuthority: "approved",
    reason: "Owner approved the exact provider diff.",
    approvalReference: "provider-risk-facebook-extractor",
  });
  const implemented = transitionTask({
    stateRoot,
    taskId: "provider-change",
    ...runner,
    toState: "implemented",
  });
  assert.equal(implemented.task.state, "implemented");
});

test("governance and failure states return through conservative reconciliation paths", () => {
  assert.ok(TASK_STATES.includes("governance_blocked"));
  assert.ok(TASK_STATES.includes("superseded"));
  assert.ok(TASK_STATES.includes("implementation_failed"));
  assert.ok(TASK_STATES.includes("closed"));

  assert.equal(isTaskTransitionAllowed("observed", "governance_blocked"), true);
  assert.equal(isTaskTransitionAllowed("governance_blocked", "triaged"), true);
  assert.equal(
    isTaskTransitionAllowed("implemented", "implementation_failed"),
    true,
  );
  assert.equal(
    isTaskTransitionAllowed("implementation_failed", "triaged"),
    true,
  );
  assert.equal(isTaskTransitionAllowed("triaged", "superseded"), true);
  assert.equal(isTaskTransitionAllowed("superseded", "closed"), true);
  assert.equal(isTaskTransitionAllowed("verified_effective", "closed"), true);

  assert.equal(isTaskTransitionAllowed("observed", "closed"), false);
  assert.equal(
    isTaskTransitionAllowed("governance_blocked", "implemented"),
    false,
  );
  assert.equal(
    isTaskTransitionAllowed("implementation_failed", "validated"),
    false,
  );
  assert.equal(isTaskTransitionAllowed("superseded", "triaged"), false);
  assert.equal(isTaskTransitionAllowed("closed", "triaged"), true);
  assert.equal(isTaskTransitionAllowed("closed", "observed"), false);
  assert.equal(isTaskTransitionAllowed("verified_neutral", "closed"), false);
});

test("behavioral classification and the installed soak slot are immutable control invariants", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const runner = actorLease(stateRoot, "freed-nightly-runner");

  assert.throws(
    () =>
      createTask({
        stateRoot,
        taskId: "missing-classification",
        ...controller,
        observerAuthority: "merge-safe",
        providerAuthority: "forbidden",
        details: {},
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "behavioral_classification_required",
  );

  for (const taskId of ["behavior-a", "behavior-b"]) {
    createTask({
      stateRoot,
      taskId,
      ...controller,
      observerAuthority: "merge-safe",
      providerAuthority: "forbidden",
      details: { behavioral: true },
    });
    transitionTask({ stateRoot, taskId, ...controller, toState: "triaged" });
  }
  transitionTask({
    stateRoot,
    taskId: "behavior-a",
    ...controller,
    toState: "approved_for_pr",
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "behavior-b",
        ...controller,
        toState: "approved_for_pr",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "behavior_slot_conflict",
  );
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "behavior-a",
        ...runner,
        toState: "implemented",
        details: { behavioral: false },
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "behavioral_classification_immutable",
  );

  transitionTask({
    stateRoot,
    taskId: "behavior-a",
    ...runner,
    toState: "implemented",
  });
  transitionTask({
    stateRoot,
    taskId: "behavior-a",
    ...runner,
    toState: "validated",
  });
  transitionTask({
    stateRoot,
    taskId: "behavior-a",
    ...runner,
    toState: "merged",
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "behavior-a",
        ...runner,
        toState: "superseded",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "behavior_outcome_required",
  );
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "behavior-a",
        ...runner,
        toState: "installed",
      }),
    /installedIdentity/,
  );
  const installed = transitionTask({
    stateRoot,
    taskId: "behavior-a",
    ...runner,
    toState: "installed",
    details: {
      behavioral: true,
      installedIdentity: {
        version: "26.7.100-dev",
        commitSha: "2".repeat(40),
        channel: "dev",
      },
    },
    nowMs: Date.parse("2026-07-10T12:00:00Z"),
  });
  assert.equal(installed.task.installedBuild, "26.7.100-dev");
  assert.deepEqual(installed.task.installedIdentity, {
    version: "26.7.100-dev",
    commitSha: "2".repeat(40),
    channel: "dev",
  });
  assert.equal(installed.task.installedAt, "2026-07-10T12:00:00.000Z");
  const soaking = transitionTask({
    stateRoot,
    taskId: "behavior-a",
    ...runner,
    toState: "soaking",
    nowMs: Date.parse("2026-07-10T12:05:00Z"),
  });
  assert.equal(soaking.task.soakStartedAt, "2026-07-10T12:05:00.000Z");
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "behavior-a",
        ...runner,
        toState: "superseded",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "behavior_outcome_required",
  );
  transitionTask({
    stateRoot,
    taskId: "behavior-a",
    ...runner,
    toState: "governance_blocked",
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "behavior-a",
        ...controller,
        toState: "closed",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "behavior_outcome_required",
  );
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "behavior-a",
        ...controller,
        toState: "triaged",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "behavior_outcome_required",
  );

  assert.throws(
    () =>
      appendControlEvent({
        stateRoot,
        type: "outcome_recorded",
        ...controller,
        taskId: "behavior-a",
        data: {},
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "reserved_event_type",
  );

  const manifestPath = automationControlPaths(stateRoot).taskManifest;
  const corruptManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  corruptManifest.tasks.find(
    (task) => task.taskId === "behavior-a",
  ).details.behavioral = false;
  writeFileSync(manifestPath, `${JSON.stringify(corruptManifest)}\n`);
  assert.throws(
    () => readTaskManifest({ stateRoot }),
    (error) =>
      error instanceof AutomationControlError && error.code === "invalid_state",
  );
});

test("new writes reject release authority while legacy records downgrade to merge-safe", () => {
  assert.deepEqual(OBSERVER_AUTHORITIES, [
    "observe-only",
    "plan-only",
    "pr-only",
    "merge-safe",
  ]);
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  assert.throws(
    () =>
      createTask({
        stateRoot,
        taskId: "legacy-new-write",
        ...controller,
        observerAuthority: "release",
        providerAuthority: "forbidden",
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "invalid_value",
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "nightly-writer",
        owner: "freed-nightly-runner",
        ttlMs: 1_000,
        observerAuthority: "release",
        providerAuthority: "forbidden",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_policy_mismatch",
  );

  const paths = automationControlPaths(stateRoot);
  mkdirSync(path.dirname(paths.taskManifest), { recursive: true });
  writeFileSync(
    paths.taskManifest,
    `${JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      updatedAt: "2026-07-10T10:00:00.000Z",
      tasks: [
        {
          schemaVersion: 1,
          taskId: "legacy-release-task",
          state: "triaged",
          revision: 1,
          observerAuthority: "release",
          providerAuthority: "forbidden",
          createdAt: "2026-07-10T10:00:00.000Z",
          updatedAt: "2026-07-10T10:00:00.000Z",
          details: {},
        },
      ],
    })}\n`,
  );

  const legacyTask = readTask({ stateRoot, taskId: "legacy-release-task" });
  assert.equal(legacyTask.observerAuthority, "merge-safe");
});

test("provider approval requires a reference and authority changes are audited", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const approval = {
    schemaVersion: 1,
    approvalId: "provider-risk-p1-04-facebook-lifecycle",
    approvedBy: "AubreyF",
    ownerApprovalReference: "Owner approved the exact P1-04 provider diff.",
    approvalSource: { kind: "control-task", reference: "P1-04" },
    approvedAt: new Date(nowMs - 60_000).toISOString(),
    expiresAt: new Date(nowMs + 86_400_000).toISOString(),
    providers: ["facebook"],
    observableBehavior:
      "Changes the existing Facebook provider lifecycle behavior.",
    fingerprintingRisk:
      "Changed lifecycle timing could make the session easier to distinguish.",
    lowestProfileAlternative:
      "Keep the existing lifecycle and collect passive diagnostics.",
    diffSha: "a".repeat(40),
    paths: ["packages/desktop/src-tauri/src/fb-extract.js"],
    pathScopes: [
      {
        path: "packages/desktop/src-tauri/src/fb-extract.js",
        providers: ["facebook"],
      },
    ],
  };
  const authorizationDigest = providerApprovalAuthorizationDigest(approval);
  createTask({
    stateRoot,
    taskId: "P1-04",
    ...controller,
    observerAuthority: "pr-only",
    providerAuthority: "approval-required",
    details: { behavioral: true },
    nowMs: nowMs + 1_000,
  });
  transitionTask({
    stateRoot,
    taskId: "P1-04",
    ...controller,
    toState: "triaged",
    expectedRevision: 1,
    nowMs: nowMs + 2_000,
  });
  const owner = actorLease(stateRoot, "freed-owner", {
    nowMs: nowMs + 3_000,
    ownerTaskId: "P1-04",
    ownerIntentDigest: ownerIntent("task.authorize", "P1-04", {
      observerAuthority: "merge-safe",
      providerAuthority: "approved",
      reason: "Scoped provider lifecycle work approved.",
      approvalReference: authorizationDigest,
      expectedRevision: 2,
    }),
  });
  const ownerLeaseRecord = JSON.parse(
    readFileSync(
      path.join(
        automationControlPaths(stateRoot).leases,
        "owner-governance.lease/lease.json",
      ),
      "utf8",
    ),
  );
  appendFileSync(
    automationControlPaths(stateRoot).events,
    `${JSON.stringify({
      schemaVersion: 1,
      eventId: "provider-owner-capability-lease",
      type: "lease_acquired",
      ts: ownerLeaseRecord.acquiredAt,
      actor: "freed-owner",
      leaseName: "owner-governance",
      data: {
        credentialKind: ownerLeaseRecord.credentialKind,
        ownerCapabilityId: ownerLeaseRecord.ownerCapabilityId,
        ownerCapabilityTaskId: ownerLeaseRecord.ownerCapabilityTaskId,
        ownerCapabilityIntentDigest:
          ownerLeaseRecord.ownerCapabilityIntentDigest,
      },
    })}\n`,
  );
  assert.throws(
    () =>
      updateTaskAuthorities({
        stateRoot,
        taskId: "P1-04",
        ...owner,
        providerAuthority: "approved",
        reason: "Provider lifecycle work approved.",
      }),
    /approvalReference/,
  );
  assert.throws(
    () =>
      updateTaskAuthorities({
        stateRoot,
        taskId: "P1-04",
        ...owner,
        observerAuthority: "merge-safe",
        providerAuthority: "approved",
        reason: "A different, unsigned governance intent.",
        approvalReference: authorizationDigest,
        expectedRevision: 2,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_capability_intent_mismatch",
  );

  const update = updateTaskAuthorities({
    stateRoot,
    taskId: "P1-04",
    ...owner,
    observerAuthority: "merge-safe",
    providerAuthority: "approved",
    reason: "Scoped provider lifecycle work approved.",
    approvalReference: authorizationDigest,
    expectedRevision: 2,
    nowMs: nowMs + 4_000,
  });
  assert.equal(update.task.observerAuthority, "merge-safe");
  assert.equal(update.task.providerAuthority, "approved");
  const event = readEvents(stateRoot).at(-1);
  assert.equal(event.type, "task_authority_updated");
  assert.equal(event.data.approvalReference, authorizationDigest);
  assert.equal(
    event.data.authorizationProvenance.leaseName,
    "owner-governance",
  );
  assert.equal(
    event.data.authorizationProvenance.credentialKind,
    "owner-signed-capability",
  );
  assert.match(
    event.data.authorizationProvenance.ownerCapabilityId,
    /^owner-test-/,
  );
  assert.equal(
    event.data.authorizationProvenance.ownerCapabilityTaskId,
    "P1-04",
  );
  transitionTask({
    stateRoot,
    taskId: "P1-04",
    ...controller,
    toState: "approved_for_pr",
    expectedRevision: 3,
    nowMs: nowMs + 5_000,
  });
  const validatedApproval = validateProviderRiskApproval(
    approval,
    approval.paths,
    {
      now: nowMs + 6_000,
      diffSha: approval.diffSha,
      controlManifest: readTaskManifest({ stateRoot }),
      controlEvents: readEvents(stateRoot),
    },
  );
  assert.equal(validatedApproval.authorizationDigest, authorizationDigest);
});

test("approved provider tasks require and retain an owner approval reference at creation", () => {
  const stateRoot = temporaryStateRoot();
  const owner = actorLease(stateRoot, "freed-owner", {
    ownerTaskId: "approved-with-reference",
    ownerIntentDigest: ownerIntent("task.create", "approved-with-reference", {
      state: "observed",
      observerAuthority: "merge-safe",
      providerAuthority: "approved",
      approvalReference: "owner-task-019f-provider-scope",
      details: { behavioral: true },
    }),
  });
  assert.throws(
    () =>
      createTask({
        stateRoot,
        taskId: "approved-without-reference",
        ...owner,
        observerAuthority: "merge-safe",
        providerAuthority: "approved",
      }),
    /approvalReference/,
  );

  const created = createTask({
    stateRoot,
    taskId: "approved-with-reference",
    ...owner,
    observerAuthority: "merge-safe",
    providerAuthority: "approved",
    approvalReference: "owner-task-019f-provider-scope",
    details: { behavioral: true },
  });
  assert.equal(
    created.task.providerApprovalReference,
    "owner-task-019f-provider-scope",
  );
  const event = readEvents(stateRoot).at(-1);
  assert.equal(
    event.providerApprovalReference,
    "owner-task-019f-provider-scope",
  );
  assert.equal(event.data.approvalReference, "owner-task-019f-provider-scope");
});

test("owner capability signature is bound to task, intent, state root, and lease token", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-10T14:00:00Z");
  const taskId = "owner-capability-task";
  const intentDigest = ownerIntent("task.authorize", taskId, {
    observerAuthority: "merge-safe",
    providerAuthority: null,
    reason: "Approve the reviewed local task.",
    approvalReference: null,
    expectedRevision: 1,
  });
  const leaseToken = "owner-capability-lease-token-1234567890";
  const signed = signedOwnerCapability(
    stateRoot,
    taskId,
    intentDigest,
    leaseToken,
    { nowMs, ttlMs: 60_000 },
  );
  const verified = verifyOwnerCapabilityEnvelope({
    envelope: signed.envelope,
    publicKeyBase64: signed.publicKeyBase64,
    stateRoot,
    taskId,
    intentDigest,
    leaseToken,
    ttlMs: 60_000,
    nowMs: nowMs + 1_000,
  });
  assert.equal(verified.taskId, taskId);
  assert.equal(verified.intentDigest, intentDigest);

  const forged = signedOwnerCapability(
    stateRoot,
    taskId,
    intentDigest,
    leaseToken,
    { nowMs, ttlMs: 60_000 },
  );
  assert.throws(
    () =>
      verifyOwnerCapabilityEnvelope({
        envelope: forged.envelope,
        publicKeyBase64: signed.publicKeyBase64,
        stateRoot,
        taskId,
        intentDigest,
        leaseToken,
        ttlMs: 60_000,
        nowMs: nowMs + 1_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_capability_signature_invalid",
  );
  assert.throws(
    () =>
      verifyOwnerCapabilityEnvelope({
        envelope: signed.envelope,
        publicKeyBase64: signed.publicKeyBase64,
        stateRoot,
        taskId: "different-task",
        intentDigest,
        leaseToken,
        ttlMs: 60_000,
        nowMs: nowMs + 1_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_capability_invalid",
  );
});

test("same-UID owner bootstrap files cannot authenticate governance", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-10T14:00:00Z");
  const forgedPath = path.join(
    automationControlPaths(stateRoot).controlRoot,
    "owner-bootstrap.json",
  );
  mkdirSync(path.dirname(forgedPath), { recursive: true });
  writeFileSync(
    forgedPath,
    `${JSON.stringify({
      schemaVersion: 1,
      grantId: "same-uid-forgery",
      actor: "freed-owner",
      purpose: "owner-governance-lease",
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 60_000).toISOString(),
      tokenSha256: createHash("sha256").update("forged-token").digest("hex"),
    })}\n`,
    { mode: 0o600 },
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "owner-governance",
        owner: "freed-owner",
        ttlMs: 60_000,
        nowMs,
        token: "forged-token",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_capability_required",
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "owner-governance",
        owner: "freed-owner",
        ttlMs: 60_000,
        nowMs,
        token: "forged-token",
        ownerCapabilityFile: forgedPath,
        ownerCapabilityTaskId: "forged-task",
        ownerCapabilityIntentDigest: "a".repeat(64),
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_capability_trust_invalid",
  );
});

test("non-owner lease acquisition requires the matching persistent actor credential", () => {
  const stateRoot = temporaryStateRoot();
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "nightly-writer",
        owner: "freed-nightly-runner",
        ttlMs: 60_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_credential_required",
  );

  const actorCredentialToken = writeActorCredential(
    stateRoot,
    "freed-nightly-runner",
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "nightly-writer",
        owner: "freed-nightly-runner",
        ttlMs: 60_000,
        actorCredentialToken: "wrong-persistent-actor-secret-1234567890",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_credential_mismatch",
  );
  const acquired = acquireLease({
    stateRoot,
    name: "nightly-writer",
    owner: "freed-nightly-runner",
    ttlMs: 60_000,
    actorCredentialToken,
  });
  assert.equal(acquired.lease.credentialKind, "persistent-actor");
});

test("owner lease lifetime cannot outlive its signed capability limit", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-10T15:00:00Z");
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "owner-governance",
        owner: "freed-owner",
        ttlMs: 16 * 60_000,
        nowMs,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_lease_ttl_exceeded",
  );

  const acquired = actorLease(stateRoot, "freed-owner", {
    nowMs,
    token: "owner-lifetime-lease-token",
    ownerTaskId: "owner-lifetime-task",
    ownerIntentDigest: "a".repeat(64),
  });
  const heartbeat = heartbeatLease({
    stateRoot,
    name: "owner-governance",
    token: acquired.leaseToken,
    ttlMs: 10 * 60_000,
    nowMs: nowMs + 9 * 60_000,
  });
  assert.equal(
    heartbeat.lease.expiresAt,
    new Date(nowMs + 15 * 60_000).toISOString(),
  );
  assert.throws(
    () =>
      heartbeatLease({
        stateRoot,
        name: "owner-governance",
        token: acquired.leaseToken,
        ttlMs: 60_000,
        nowMs: nowMs + 15 * 60_000,
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_expired",
  );
});

test("publisher lease has a fixed absolute lifetime", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-10T15:00:00Z");
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(stateRoot),
    branch: "fix/publisher-scope-test",
    base: "dev",
    baseSha: "a".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 31 * 60_000,
        nowMs,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_ttl_invalid",
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_scope_required",
  );

  const capability = writePublisherCapability(stateRoot, scope, { nowMs });
  const acquired = acquireLease({
    stateRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    ttlMs: 30 * 60_000,
    nowMs,
    publisherCapabilityFile: capability.capabilityPath,
    scope,
  });
  assert.equal(acquired.lease.credentialKind, "signed-capability");
  assert.equal(acquired.lease.publisherCapabilityId, capability.capabilityId);
  assert.equal(existsSync(capability.capabilityPath), false);
  const bound = bindPublisherLeaseHead({
    stateRoot,
    token: acquired.lease.token,
    scope,
    headSha: "b".repeat(40),
    nowMs: nowMs + 1_000,
  });
  assert.equal(bound.lease.scope.headSha, "b".repeat(40));
  assert.throws(
    () =>
      bindPublisherLeaseHead({
        stateRoot,
        token: acquired.lease.token,
        scope,
        headSha: "c".repeat(40),
        nowMs: nowMs + 2_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_head_mismatch",
  );
  const heartbeat = heartbeatLease({
    stateRoot,
    name: "pr-publisher",
    token: acquired.lease.token,
    ttlMs: 30 * 60_000,
    nowMs: nowMs + 19 * 60_000,
  });
  assert.equal(
    heartbeat.lease.expiresAt,
    new Date(nowMs + 30 * 60_000).toISOString(),
  );
});

test("publisher scope binds distinct governed main modes", () => {
  const nowMs = Date.parse("2026-07-10T15:20:00Z");
  const releaseStateRoot = temporaryStateRoot();
  const releaseScope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(releaseStateRoot),
    branch: "chore/release-v26.7.1001",
    base: "main",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    publishMode: "production-release-prep",
  };
  const releaseCapability = writePublisherCapability(
    releaseStateRoot,
    releaseScope,
    {
      nowMs,
    },
  );
  const releaseLease = acquireLease({
    stateRoot: releaseStateRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    ttlMs: 30 * 60_000,
    nowMs,
    publisherCapabilityFile: releaseCapability.capabilityPath,
    scope: releaseScope,
  });
  assert.equal(releaseLease.lease.scope.publishMode, "production-release-prep");

  const promotionStateRoot = temporaryStateRoot();
  const promotionScope = {
    ...releaseScope,
    worktree: realpathSync(promotionStateRoot),
    branch: "chore/promote-dev-to-main-v26.7.1001",
    publishMode: "production-promotion",
  };
  const promotionCapability = writePublisherCapability(
    promotionStateRoot,
    promotionScope,
    { nowMs },
  );
  const promotionLease = acquireLease({
    stateRoot: promotionStateRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    ttlMs: 30 * 60_000,
    nowMs,
    publisherCapabilityFile: promotionCapability.capabilityPath,
    scope: promotionScope,
  });
  assert.equal(promotionLease.lease.scope.publishMode, "production-promotion");

  const mismatchedStateRoot = temporaryStateRoot();
  const mismatchedScope = {
    ...releaseScope,
    worktree: realpathSync(mismatchedStateRoot),
    publishMode: "production-promotion",
  };
  const mismatchedCapability = writePublisherCapability(
    mismatchedStateRoot,
    mismatchedScope,
    { nowMs },
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot: mismatchedStateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs,
        publisherCapabilityFile: mismatchedCapability.capabilityPath,
        scope: mismatchedScope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_scope_invalid",
  );
});

test("publisher acquisition rejects reusable credentials, tampering, permissive files, and replay", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-10T15:30:00Z");
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(stateRoot),
    branch: "fix/publisher-capability-test",
    base: "dev",
    baseSha: "d".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  writeActorCredential(stateRoot, "freed-pr-publisher");
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs,
        actorCredentialToken: "publisher-persistent-secret-1234567890",
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_reusable_credential_forbidden",
  );

  const wrongLifetime = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-capability-wrong-lifetime",
    lifetimeMs: 61_000,
  });
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs,
        publisherCapabilityFile: wrongLifetime.capabilityPath,
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_capability_invalid",
  );

  const extraScope = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-capability-extra-scope",
    payloadScope: { ...scope, command: "unexpected" },
  });
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs,
        publisherCapabilityFile: extraScope.capabilityPath,
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_scope_invalid",
  );

  const permissive = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-capability-permissions",
  });
  chmodSync(permissive.capabilityPath, 0o644);
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs,
        publisherCapabilityFile: permissive.capabilityPath,
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_capability_permissions_invalid",
  );

  const tampered = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-capability-tampered",
  });
  const tamperedEnvelope = JSON.parse(
    readFileSync(tampered.capabilityPath, "utf8"),
  );
  tamperedEnvelope.signatureBase64 = Buffer.alloc(64, 7).toString("base64");
  writeFileSync(
    tampered.capabilityPath,
    `${JSON.stringify(tamperedEnvelope)}\n`,
    { mode: 0o600 },
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs,
        publisherCapabilityFile: tampered.capabilityPath,
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_capability_signature_invalid",
  );

  const replay = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-capability-replay",
  });
  const replayEnvelope = readFileSync(replay.capabilityPath, "utf8");
  const acquired = acquireLease({
    stateRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    ttlMs: 30 * 60_000,
    nowMs,
    publisherCapabilityFile: replay.capabilityPath,
    scope,
  });
  releaseLease({
    stateRoot,
    name: "pr-publisher",
    token: acquired.lease.token,
    nowMs: nowMs + 1_000,
  });
  writeFileSync(replay.capabilityPath, replayEnvelope, { mode: 0o600 });
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs: nowMs + 2_000,
        publisherCapabilityFile: replay.capabilityPath,
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_capability_replayed",
  );
});

test("lease validation rejects a permissive bearer record", () => {
  const stateRoot = temporaryStateRoot();
  const lease = actorLease(stateRoot, "freed-release-verifier");
  const leasePath = path.join(
    automationControlPaths(stateRoot).leases,
    `${lease.leaseName}.lease/lease.json`,
  );
  chmodSync(leasePath, 0o644);
  assert.throws(
    () =>
      heartbeatLease({
        stateRoot,
        name: lease.leaseName,
        token: lease.leaseToken,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_permissions_invalid",
  );
});

test("lease validation rejects a permissive lease directory", () => {
  const stateRoot = temporaryStateRoot();
  const lease = actorLease(stateRoot, "freed-release-verifier");
  const leaseDirectory = path.join(
    automationControlPaths(stateRoot).leases,
    `${lease.leaseName}.lease`,
  );
  chmodSync(leaseDirectory, 0o755);
  assert.throws(
    () =>
      heartbeatLease({
        stateRoot,
        name: lease.leaseName,
        token: lease.leaseToken,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "invalid_state_permissions",
  );
});

test("an authenticated actor upgrades only its own live legacy lease", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-scaffolding-maintainer";
  const nowMs = Date.parse("2026-07-10T16:00:00Z");
  const legacy = writeLegacyLease(stateRoot, actor, { nowMs });
  const inspectedLegacy = inspectLease({
    stateRoot,
    name: legacy.policy.leaseName,
    nowMs,
  });
  assert.equal(inspectedLegacy.status, "active");
  assert.equal(inspectedLegacy.legacyUncredentialed, true);
  assert.equal(Object.hasOwn(inspectedLegacy, "token"), false);
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const acquired = acquireLease({
    stateRoot,
    name: legacy.policy.leaseName,
    owner: actor,
    ttlMs: 60_000,
    nowMs,
    token: "scaffolding-upgraded-token",
    actorCredentialToken,
  });

  assert.equal(acquired.takeover, true);
  assert.equal(acquired.credentialUpgrade, true);
  assert.equal(acquired.previous.legacyUncredentialed, true);
  assert.equal(acquired.lease.credentialKind, "persistent-actor");
  assert.equal(acquired.lease.token, "scaffolding-upgraded-token");
  const upgradeEvent = readEvents(stateRoot).at(-1);
  assert.equal(upgradeEvent.type, "lease_credential_upgraded");
  assert.equal(upgradeEvent.data.credentialUpgrade, true);
  assert.throws(
    () =>
      heartbeatLease({
        stateRoot,
        name: legacy.policy.leaseName,
        token: legacy.record.token,
        nowMs: nowMs + 1_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_token_mismatch",
  );
  assert.throws(
    () =>
      releaseLease({
        stateRoot,
        name: legacy.policy.leaseName,
        token: legacy.record.token,
        nowMs: nowMs + 1_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_token_mismatch",
  );
});

test("legacy lease upgrade rejects unauthenticated, cross-actor, and token-reuse attempts", () => {
  const unauthenticatedRoot = temporaryStateRoot();
  const actor = "freed-scaffolding-maintainer";
  const unauthenticated = writeLegacyLease(unauthenticatedRoot, actor);
  assert.throws(
    () =>
      acquireLease({
        stateRoot: unauthenticatedRoot,
        name: unauthenticated.policy.leaseName,
        owner: actor,
        ttlMs: 60_000,
        token: "unauthenticated-upgrade-token",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_credential_required",
  );

  const crossActorRoot = temporaryStateRoot();
  const crossActor = writeLegacyLease(crossActorRoot, actor, {
    owner: "freed-nightly-runner",
  });
  const actorCredentialToken = writeActorCredential(crossActorRoot, actor);
  assert.throws(
    () =>
      acquireLease({
        stateRoot: crossActorRoot,
        name: crossActor.policy.leaseName,
        owner: actor,
        ttlMs: 60_000,
        token: "cross-actor-upgrade-token",
        actorCredentialToken,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "legacy_lease_owner_mismatch",
  );

  const tokenReuseRoot = temporaryStateRoot();
  const tokenReuse = writeLegacyLease(tokenReuseRoot, actor);
  const tokenReuseCredential = writeActorCredential(tokenReuseRoot, actor);
  assert.throws(
    () =>
      acquireLease({
        stateRoot: tokenReuseRoot,
        name: tokenReuse.policy.leaseName,
        owner: actor,
        ttlMs: 60_000,
        token: tokenReuse.record.token,
        actorCredentialToken: tokenReuseCredential,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_token_reuse",
  );
});

test("named leases are exclusive and inspection redacts the token", () => {
  const stateRoot = temporaryStateRoot();
  const actorCredentialToken = writeActorCredential(
    stateRoot,
    "freed-nightly-runner",
  );
  const first = acquireLease({
    stateRoot,
    name: "nightly-writer",
    owner: "freed-nightly-runner",
    ttlMs: 60_000,
    nowMs: 1_000,
    token: "token-a",
    actorCredentialToken,
  });
  assert.equal(first.acquired, true);
  assert.equal(first.takeover, false);
  assert.equal(first.lease.token, "token-a");
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "nightly-writer",
        owner: "freed-nightly-runner",
        ttlMs: 60_000,
        nowMs: 2_000,
        token: "token-b",
        actorCredentialToken,
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_busy",
  );
  const inspected = inspectLease({
    stateRoot,
    name: "nightly-writer",
    nowMs: 2_000,
  });
  assert.equal(inspected.owner, "freed-nightly-runner");
  assert.equal(inspected.status, "active");
  assert.equal(Object.hasOwn(inspected, "token"), false);
});

test("expired lease takeover is safe and old tokens cannot touch the replacement", () => {
  const stateRoot = temporaryStateRoot();
  const actorCredentialToken = writeActorCredential(
    stateRoot,
    "freed-release-verifier",
  );
  acquireLease({
    stateRoot,
    name: "release-verifier",
    owner: "freed-release-verifier",
    ttlMs: 1_000,
    nowMs: 10_000,
    token: "old-token",
    actorCredentialToken,
  });
  const takeover = acquireLease({
    stateRoot,
    name: "release-verifier",
    owner: "freed-release-verifier",
    ttlMs: 5_000,
    nowMs: 11_001,
    token: "new-token",
    actorCredentialToken,
  });
  assert.equal(takeover.takeover, true);
  assert.equal(takeover.previous.owner, "freed-release-verifier");
  assert.equal(takeover.lease.token, "new-token");
  assert.throws(
    () =>
      heartbeatLease({
        stateRoot,
        name: "release-verifier",
        token: "old-token",
        nowMs: 11_100,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_token_mismatch",
  );
  assert.throws(
    () =>
      releaseLease({
        stateRoot,
        name: "release-verifier",
        token: "old-token",
        nowMs: 11_100,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_token_mismatch",
  );
  assert.equal(
    inspectLease({ stateRoot, name: "release-verifier", nowMs: 11_100 }).owner,
    "freed-release-verifier",
  );
  assert.deepEqual(
    readEvents(stateRoot).map((event) => event.type),
    ["lease_acquired", "lease_taken_over"],
  );
});

test("lease heartbeat extends a live lease and release is token checked", () => {
  const stateRoot = temporaryStateRoot();
  const actorCredentialToken = writeActorCredential(
    stateRoot,
    "freed-runtime-observer",
  );
  acquireLease({
    stateRoot,
    name: "runtime-observer",
    owner: "freed-runtime-observer",
    ttlMs: 1_000,
    nowMs: 20_000,
    token: "observer-token",
    actorCredentialToken,
  });
  const heartbeat = heartbeatLease({
    stateRoot,
    name: "runtime-observer",
    token: "observer-token",
    ttlMs: 4_000,
    nowMs: 20_500,
  });
  assert.equal(heartbeat.lease.heartbeatAt, "1970-01-01T00:00:20.500Z");
  assert.equal(heartbeat.lease.expiresAt, "1970-01-01T00:00:24.500Z");
  assert.throws(
    () =>
      releaseLease({
        stateRoot,
        name: "runtime-observer",
        token: "wrong-token",
        nowMs: 21_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_token_mismatch",
  );
  const released = releaseLease({
    stateRoot,
    name: "runtime-observer",
    token: "observer-token",
    nowMs: 21_000,
  });
  assert.equal(released.released, true);
  assert.equal(
    inspectLease({ stateRoot, name: "runtime-observer", nowMs: 21_000 }),
    null,
  );
  assert.deepEqual(
    readEvents(stateRoot).map((event) => event.type),
    ["lease_acquired", "lease_heartbeat", "lease_released"],
  );
});

test("expired leases cannot be revived by heartbeat", () => {
  const stateRoot = temporaryStateRoot();
  const actorCredentialToken = writeActorCredential(
    stateRoot,
    "freed-release-verifier",
  );
  acquireLease({
    stateRoot,
    name: "release-verifier",
    owner: "freed-release-verifier",
    ttlMs: 1_000,
    nowMs: 30_000,
    token: "verifier-token",
    actorCredentialToken,
  });
  assert.throws(
    () =>
      heartbeatLease({
        stateRoot,
        name: "release-verifier",
        token: "verifier-token",
        nowMs: 31_001,
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_expired",
  );
});

test("CLI emits structured JSON for task and lease operations", () => {
  const stateRoot = temporaryStateRoot();
  const controllerCredential = writeActorCredential(
    stateRoot,
    "freed-stability-controller",
  );
  const controllerLease = runCli(
    [
      "lease",
      "acquire",
      "--state-root",
      stateRoot,
      "--name",
      "stability-controller",
      "--owner",
      "freed-stability-controller",
      "--ttl-seconds",
      "60",
    ],
    {
      env: {
        ...process.env,
        FREED_AUTOMATION_ACTOR_TOKEN: controllerCredential,
      },
    },
  );
  const created = runCli([
    "task",
    "create",
    "--state-root",
    stateRoot,
    "--id",
    "P0-03",
    "--actor",
    "freed-stability-controller",
    "--lease-name",
    "stability-controller",
    "--lease-token",
    controllerLease.result.lease.token,
    "--observer-authority",
    "plan-only",
    "--provider-authority",
    "forbidden",
    "--details-json",
    '{"behavioral":false,"metricId":"control-state"}',
  ]);
  assert.equal(created.ok, true);
  assert.equal(created.action, "task.create");
  assert.equal(created.result.task.taskId, "P0-03");

  const nightlyCredential = writeActorCredential(
    stateRoot,
    "freed-nightly-runner",
  );
  const lease = runCli(
    [
      "lease",
      "acquire",
      "--state-root",
      stateRoot,
      "--name",
      "nightly-writer",
      "--owner",
      "freed-nightly-runner",
      "--ttl-seconds",
      "60",
    ],
    {
      env: { ...process.env, FREED_AUTOMATION_ACTOR_TOKEN: nightlyCredential },
    },
  );
  assert.equal(lease.ok, true);
  assert.equal(lease.result.lease.owner, "freed-nightly-runner");
  assert.equal(lease.result.lease.observerAuthority, "merge-safe");
  assert.equal(lease.result.lease.providerAuthority, "approval-required");
  assert.ok(lease.result.lease.token);

  const shown = runCli([
    "lease",
    "show",
    "--state-root",
    stateRoot,
    "--name",
    "nightly-writer",
  ]);
  assert.equal(shown.result.owner, "freed-nightly-runner");
  assert.equal(Object.hasOwn(shown.result, "token"), false);

  const heartbeated = runCli(
    [
      "lease",
      "heartbeat",
      "--state-root",
      stateRoot,
      "--name",
      "nightly-writer",
      "--ttl-seconds",
      "60",
    ],
    {
      env: {
        ...process.env,
        FREED_AUTOMATION_LEASE_TOKEN: lease.result.lease.token,
      },
    },
  );
  assert.equal(heartbeated.result.heartbeated, true);
});

test("CLI computes the canonical owner governance intent digest", () => {
  const intent = {
    schemaVersion: 1,
    action: "task.authorize",
    taskId: "owner-digest-task",
    parameters: {
      observerAuthority: "merge-safe",
      providerAuthority: null,
      reason: "Approve the reviewed task.",
      approvalReference: null,
      expectedRevision: 1,
    },
  };
  const result = runCli([
    "owner",
    "intent-digest",
    "--intent-json",
    JSON.stringify(intent),
  ]);
  assert.equal(result.result.intentDigest, ownerGovernanceIntentDigest(intent));
});

test("CLI cannot mint freed-owner without a signed owner capability", async () => {
  const stateRoot = temporaryStateRoot();
  const args = [
    "lease",
    "acquire",
    "--state-root",
    stateRoot,
    "--name",
    "owner-governance",
    "--owner",
    "freed-owner",
    "--ttl-seconds",
    "60",
  ];
  const missing = await spawnCli(args);
  assert.equal(missing.code, 1);
  assert.equal(JSON.parse(missing.stderr).error.code, "invalid_argument");

  const noCapability = await spawnCli(args, {
    env: {
      ...process.env,
      FREED_OWNER_LEASE_TOKEN: "cli-owner-lease-token-123456789012345",
      FREED_OWNER_BOOTSTRAP_TOKEN: "ignored-same-uid-bootstrap-token",
    },
  });
  assert.equal(noCapability.code, 1);
  assert.equal(
    JSON.parse(noCapability.stderr).error.code,
    "owner_capability_required",
  );
});

test("concurrent CLI acquisition produces one lease owner", async () => {
  const stateRoot = temporaryStateRoot();
  const actorCredentialToken = writeActorCredential(
    stateRoot,
    "freed-nightly-runner",
  );
  const attempts = await Promise.all(
    Array.from({ length: 6 }, () =>
      spawnCli(
        [
          "lease",
          "acquire",
          "--state-root",
          stateRoot,
          "--name",
          "nightly-writer",
          "--owner",
          "freed-nightly-runner",
          "--ttl-seconds",
          "60",
        ],
        {
          env: {
            ...process.env,
            FREED_AUTOMATION_ACTOR_TOKEN: actorCredentialToken,
          },
        },
      ),
    ),
  );

  const successes = attempts.filter((attempt) => attempt.code === 0);
  const failures = attempts.filter((attempt) => attempt.code !== 0);
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 5);
  assert.ok(
    failures.every(
      (attempt) => JSON.parse(attempt.stderr).error.code === "lease_busy",
    ),
  );
  const inspected = runCli([
    "lease",
    "show",
    "--state-root",
    stateRoot,
    "--name",
    "nightly-writer",
  ]);
  assert.equal(inspected.result.status, "active");
});
