import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
  AUTOMATION_KERNEL_GUARD_MARKER_DIGEST,
  AUTOMATION_KERNEL_GUARD_NAMES,
  automationKernelGuardMarkerBytes,
  automationKernelGuardCutoverPaths,
  canonicalAutomationKernelGuardReceiptBytes,
} from "../lib/automation-kernel-guard-contract.mjs";

const TEST_TASK_ID = "kernel-guard-cutover-test";
const TEST_CREATED_AT = "2026-07-18T00:00:00.000Z";
const TEST_PREPARED_AT = "2026-07-18T00:00:01.000Z";
const TEST_COMPLETED_AT = "2026-07-18T00:00:02.000Z";
const TEST_SOURCE_CODE_SHA = "f6".repeat(20);
const TEST_ACTOR_IDS = Object.freeze([
  "freed-runtime-observer",
  "freed-stability-controller",
  "freed-scaffolding-maintainer",
  "freed-nightly-runner",
  "freed-release-verifier",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

function prettyJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensurePrivateDirectory(directoryPath) {
  mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  chmodSync(directoryPath, 0o700);
}

function writeExact(filePath, bytes) {
  if (existsSync(filePath)) {
    if (!readFileSync(filePath).equals(bytes)) {
      throw new Error(`Test kernel guard fixture conflicts at ${filePath}`);
    }
    chmodSync(filePath, 0o600);
    return;
  }
  writeFileSync(filePath, bytes, { flag: "wx", mode: 0o600 });
  chmodSync(filePath, 0o600);
}

function fileSnapshot(filePath, bytes, { includeBytes = true } = {}) {
  return {
    path: filePath,
    kind: "file",
    mode: 0o600,
    size: bytes.length,
    digest: sha256(bytes),
    ...(includeBytes ? { bytesBase64: bytes.toString("base64") } : {}),
  };
}

function directorySnapshot(directoryPath, entries) {
  return {
    path: directoryPath,
    kind: "directory",
    mode: 0o700,
    entries,
  };
}

function writeSnapshotArchive(entry, targetPath) {
  if (entry.kind === "file") {
    writeExact(targetPath, Buffer.from(entry.bytesBase64, "base64"));
    return;
  }
  if (entry.kind === "missing") return;
  ensurePrivateDirectory(targetPath);
  for (const child of entry.entries) {
    writeSnapshotArchive(
      child,
      path.join(targetPath, path.basename(child.path)),
    );
  }
}

export function installAutomationKernelGuardCutoverFixture(
  stateRoot,
  { includeCanonicalTask = true, canonicalTaskOverrides = {} } = {},
) {
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  chmodSync(stateRoot, 0o700);
  const canonicalStateRoot = realpathSync(stateRoot);
  const paths = automationKernelGuardCutoverPaths(canonicalStateRoot);
  ensurePrivateDirectory(paths.controlRoot);
  ensurePrivateDirectory(paths.guardsRoot);
  for (const directoryPath of [
    path.join(paths.controlRoot, "leases", ".lease-state-quarantine"),
    path.join(paths.controlRoot, "leases"),
    path.join(paths.controlRoot, "leases", ".transactions"),
    path.join(
      paths.controlRoot,
      "leases",
      ".transactions",
      ".lease-cleanup-quarantine",
    ),
    path.join(paths.controlRoot, "leases", ".transaction-receipts"),
    path.join(
      paths.controlRoot,
      "leases",
      ".transaction-receipts",
      ".lease-cleanup-quarantine",
    ),
  ]) {
    ensurePrivateDirectory(directoryPath);
  }
  ensurePrivateDirectory(path.dirname(paths.artifactRoot));
  ensurePrivateDirectory(paths.artifactRoot);
  const markerBytes = automationKernelGuardMarkerBytes();

  for (const name of AUTOMATION_KERNEL_GUARD_NAMES) {
    const guard = paths.guards[name];
    ensurePrivateDirectory(guard.directory);
    writeExact(guard.owner, markerBytes);
    writeExact(guard.inner, markerBytes);
  }
  writeExact(paths.writerLock, markerBytes);
  writeExact(paths.bootstrapLock, markerBytes);

  const legacyWriterBytes = Buffer.from(
    `${JSON.stringify({ schemaVersion: 1, owner: "legacy-writer" })}\n`,
    "utf8",
  );
  const legacyWriter = fileSnapshot(paths.writerLock, legacyWriterBytes);
  const legacyGuards = directorySnapshot(
    paths.guardsRoot,
    [...AUTOMATION_KERNEL_GUARD_NAMES].sort().map((name) => {
      const guardPath = path.join(paths.guardsRoot, `${name}.lock`);
      const ownerBytes = Buffer.from(
        `${JSON.stringify({
          schemaVersion: 1,
          owner: `legacy-${name}`,
          pid: 42,
          processStartIdentity: "synthetic",
          acquiredAt: TEST_CREATED_AT,
        })}\n`,
        "utf8",
      );
      return directorySnapshot(guardPath, [
        fileSnapshot(path.join(guardPath, "owner.json"), ownerBytes),
      ]);
    }),
  );
  const taskManifestBytes = prettyJsonBytes({
    schemaVersion: 1,
    revision: includeCanonicalTask ? 1 : 0,
    updatedAt: TEST_CREATED_AT,
    tasks: includeCanonicalTask
      ? [
          {
            schemaVersion: 1,
            taskId: TEST_TASK_ID,
            state: "observed",
            revision: 1,
            observerAuthority: "plan-only",
            providerAuthority: "forbidden",
            behavioral: false,
            details: { behavioral: false },
            ...canonicalTaskOverrides,
          },
        ]
      : [],
  });
  const eventsBytes = Buffer.alloc(0);
  const outcomesBytes = Buffer.alloc(0);
  const actorEntries = [];
  const actors = {};
  const codexHome = path.join(canonicalStateRoot, "synthetic-codex-home");
  for (const actor of TEST_ACTOR_IDS) {
    const actorPath = path.join(
      codexHome,
      "automations",
      actor,
      "automation.toml",
    );
    const actorBytes = Buffer.from(
      `schema_version = 1\nstatus = "PAUSED"\nname = "${actor}"\n`,
      "utf8",
    );
    const actorEntry = fileSnapshot(actorPath, actorBytes);
    actorEntries.push(actorEntry);
    actors[actor] = { path: actorPath, digest: actorEntry.digest };
  }
  const sourceEntries = [
    fileSnapshot(
      path.join(paths.controlRoot, "current-tasks.json"),
      taskManifestBytes,
    ),
    fileSnapshot(path.join(paths.controlRoot, "events.jsonl"), eventsBytes, {
      includeBytes: false,
    }),
    fileSnapshot(
      path.join(canonicalStateRoot, "outcomes.jsonl"),
      outcomesBytes,
      {
        includeBytes: false,
      },
    ),
    directorySnapshot(path.join(paths.controlRoot, "leases"), []),
    legacyGuards,
    legacyWriter,
    ...actorEntries,
  ];
  const sourceSnapshot = {
    schemaVersion: 1,
    stateRoot: canonicalStateRoot,
    codexHome,
    repoRoot: path.join(canonicalStateRoot, "synthetic-repo"),
    sourceCodeSha: TEST_SOURCE_CODE_SHA,
    actors,
    entries: sourceEntries,
  };
  const legacyManifest = {
    schemaVersion: 1,
    entries: [legacyGuards, legacyWriter],
  };
  const sourceSnapshotBytes = canonicalJsonBytes(sourceSnapshot);
  const legacyManifestBytes = canonicalJsonBytes(legacyManifest);
  const sourceSnapshotDigest = sha256(sourceSnapshotBytes);
  const archiveManifestDigest = sha256(legacyManifestBytes);
  const cutoverId = sha256(
    canonicalJsonBytes({
      policy: AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
      taskId: TEST_TASK_ID,
      sourceSnapshotDigest,
      archiveManifestDigest,
      sourceCodeSha: TEST_SOURCE_CODE_SHA,
    }),
  );
  const parameters = {
    schemaVersion: 1,
    policy: AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
    stateRoot: canonicalStateRoot,
    codexHome: sourceSnapshot.codexHome,
    repoRoot: sourceSnapshot.repoRoot,
    sourceCodeSha: TEST_SOURCE_CODE_SHA,
    sourceSnapshotDigest,
    archiveManifestDigest,
    cutoverId,
    markerDigest: AUTOMATION_KERNEL_GUARD_MARKER_DIGEST,
    guardNames: [...AUTOMATION_KERNEL_GUARD_NAMES],
  };
  const intent = {
    schemaVersion: 1,
    action: "automation-guard.cutover",
    taskId: TEST_TASK_ID,
    parameters,
  };
  const intentDigest = sha256(Buffer.from(stableJson(intent), "utf8"));
  const plan = {
    schemaVersion: 1,
    kind: "automation-kernel-guard-cutover-plan",
    action: "automation-guard.cutover.plan",
    createdAt: TEST_CREATED_AT,
    taskId: TEST_TASK_ID,
    parameters,
    sourceSnapshot,
    intent,
    intentDigest,
  };
  const confirmationId = "test-kernel-guard-cutover";
  const confirmationPath = path.join(
    canonicalStateRoot,
    "synthetic-owner-confirmation.json",
  );
  const confirmation = {
    schemaVersion: 1,
    kind: "owner-confirmation",
    confirmationId,
    approvedBy: "AubreyF",
    ownerApprovalReference: "Synthetic completed cutover fixture approval.",
    approvalSource: { kind: "current-task", reference: TEST_TASK_ID },
    taskId: TEST_TASK_ID,
    intent,
    intentDigest,
    approvedAt: TEST_CREATED_AT,
    expiresAt: "2026-07-19T00:00:00.000Z",
  };
  const confirmationBytes = prettyJsonBytes(confirmation);
  const confirmationDigest = sha256(
    Buffer.from(stableJson(confirmation), "utf8"),
  );
  const confirmationRawDigest = sha256(confirmationBytes);
  const artifactDirectory = path.join(paths.artifactRoot, cutoverId);
  ensurePrivateDirectory(artifactDirectory);
  const authorizationRoot = path.join(artifactDirectory, "authorizations");
  ensurePrivateDirectory(authorizationRoot);
  const confirmationArtifact = path.join(
    authorizationRoot,
    `${confirmationDigest}-${confirmationRawDigest}.json`,
  );
  writeExact(confirmationArtifact, confirmationBytes);
  const authorization = {
    actor: "freed-owner",
    confirmationId,
    confirmationDigest,
    confirmationPath,
    confirmationBytesBase64: confirmationBytes.toString("base64"),
    confirmationRawDigest,
    confirmationArtifact,
    intentDigest,
    validatedAt: TEST_PREPARED_AT,
  };
  const finalAuthorization = {
    ...authorization,
    validatedAt: TEST_COMPLETED_AT,
  };
  writeExact(
    path.join(authorizationRoot, "prepared-authorization.json"),
    prettyJsonBytes(authorization),
  );
  const transaction = {
    schemaVersion: 1,
    kind: "automation-kernel-guard-cutover-transaction",
    cutoverId,
    planDigest: sha256(canonicalJsonBytes(plan)),
    phase: "receipt-prepared",
    preparedAt: TEST_PREPARED_AT,
    authorizations: [authorization, finalAuthorization],
    claimGenerations: [
      {
        claimToken: "c7".repeat(32),
        claimedAt: TEST_PREPARED_AT,
        pid: 42,
        processStartIdentity: "synthetic-process-start",
      },
    ],
    completedAt: TEST_COMPLETED_AT,
  };
  const transactionBytes = prettyJsonBytes(transaction);
  const legacyRoot = path.join(artifactDirectory, "legacy-paths");
  ensurePrivateDirectory(legacyRoot);
  writeSnapshotArchive(
    legacyWriter,
    path.join(legacyRoot, "outcomes.jsonl.writer-lock"),
  );
  writeSnapshotArchive(legacyGuards, path.join(legacyRoot, "guards"));

  const core = {
    schemaVersion: 1,
    policy: AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
    cutoverId,
    stateRoot: canonicalStateRoot,
    markerDigest: AUTOMATION_KERNEL_GUARD_MARKER_DIGEST,
    guardNames: [...AUTOMATION_KERNEL_GUARD_NAMES],
    sourceSnapshotDigest,
    archiveManifestDigest,
    transactionDigest: sha256(transactionBytes),
    intentDigest,
    confirmationId,
    confirmationDigest,
    completedAt: TEST_COMPLETED_AT,
  };
  const artifactBytes = canonicalAutomationKernelGuardReceiptBytes(core);
  const artifactReceipt = path.join(artifactDirectory, "receipt.json");
  writeExact(path.join(artifactDirectory, "plan.json"), prettyJsonBytes(plan));
  writeExact(
    path.join(artifactDirectory, "source-snapshot.json"),
    sourceSnapshotBytes,
  );
  writeExact(
    path.join(artifactDirectory, "legacy-locks.json"),
    legacyManifestBytes,
  );
  writeExact(paths.transaction, transactionBytes);
  writeExact(artifactReceipt, artifactBytes);
  const globalReceipt = {
    ...core,
    artifactReceipt,
    artifactReceiptDigest: sha256(artifactBytes),
  };
  writeExact(
    paths.globalReceipt,
    Buffer.from(`${JSON.stringify(globalReceipt, null, 2)}\n`, "utf8"),
  );
  return {
    paths,
    receipt: globalReceipt,
    core,
    plan,
    transaction,
    evidence: {
      artifactDirectory,
      authorizationRoot,
      confirmationArtifact,
      preparedAuthorization: path.join(
        authorizationRoot,
        "prepared-authorization.json",
      ),
      plan: path.join(artifactDirectory, "plan.json"),
      sourceSnapshot: path.join(artifactDirectory, "source-snapshot.json"),
      legacyManifest: path.join(artifactDirectory, "legacy-locks.json"),
      legacyRoot,
      legacyWriter: path.join(legacyRoot, "outcomes.jsonl.writer-lock"),
      legacyGuardOwner: path.join(
        legacyRoot,
        "guards",
        "tasks.lock",
        "owner.json",
      ),
      transaction: paths.transaction,
      artifactReceipt,
      globalReceipt: paths.globalReceipt,
    },
  };
}

export function rewriteAutomationKernelGuardCutoverTransactionFixture(fixture) {
  const transactionBytes = prettyJsonBytes(fixture.transaction);
  const transactionDigest = sha256(transactionBytes);
  fixture.core.transactionDigest = transactionDigest;
  fixture.receipt.transactionDigest = transactionDigest;
  const artifactBytes = canonicalAutomationKernelGuardReceiptBytes(
    fixture.core,
  );
  fixture.receipt.artifactReceiptDigest = sha256(artifactBytes);
  writeFileSync(fixture.evidence.transaction, transactionBytes, {
    mode: 0o600,
  });
  chmodSync(fixture.evidence.transaction, 0o600);
  writeFileSync(fixture.evidence.artifactReceipt, artifactBytes, {
    mode: 0o600,
  });
  chmodSync(fixture.evidence.artifactReceipt, 0o600);
  writeFileSync(
    fixture.evidence.globalReceipt,
    prettyJsonBytes(fixture.receipt),
    { mode: 0o600 },
  );
  chmodSync(fixture.evidence.globalReceipt, 0o600);
}
