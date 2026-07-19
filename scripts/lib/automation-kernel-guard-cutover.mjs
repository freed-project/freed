import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

import {
  AutomationControlError,
  ownerGovernanceIntentDigest,
  processStartIdentity,
  validateCurrentTaskOwnerConfirmation,
  withKernelFileGuard,
} from "./automation-control.mjs";
import {
  AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
  AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES,
  AUTOMATION_KERNEL_GUARD_MARKER_DIGEST,
  AUTOMATION_KERNEL_GUARD_NAMES,
  automationKernelGuardCutoverPaths,
  automationKernelGuardMarkerBytes,
  canonicalAutomationKernelGuardReceiptBytes,
  inspectAutomationKernelGuardCanonicalTaskSource,
  inspectAutomationKernelGuardFilesystemPaths,
  inspectAutomationKernelGuardCutover,
} from "./automation-kernel-guard-contract.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CUTOVER_SCHEMA_VERSION = 1;
const CUTOVER_ACTION = "automation-guard.cutover";
const CUTOVER_PLAN_KIND = "automation-kernel-guard-cutover-plan";
const CUTOVER_TRANSACTION_KIND = "automation-kernel-guard-cutover-transaction";
const CUTOVER_SUPERSEDE_ACTION = "automation-guard.cutover.supersede";
const CUTOVER_SUPERSEDE_PLAN_KIND =
  "automation-kernel-guard-cutover-supersede-plan";
const CUTOVER_SUPERSEDE_RECEIPT_KIND =
  "automation-kernel-guard-cutover-superseded-receipt";
const CUTOVER_CLAIM_PROTOCOL = "freed-kernel-guard-cutover-claim-v1";
const CUTOVER_WRITE_AHEAD_KIND = "automation-kernel-guard-cutover-write-ahead";
const CUTOVER_WRITE_AHEAD_MAX_BYTES =
  AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES;
const CUTOVER_MAX_CLAIM_GENERATIONS = 64;
const CUTOVER_MAX_AUTHORIZATIONS = 64;
const CUTOVER_AUTHORIZATION_KEYS = Object.freeze(
  [
    "actor",
    "confirmationArtifact",
    "confirmationBytesBase64",
    "confirmationDigest",
    "confirmationId",
    "confirmationPath",
    "confirmationRawDigest",
    "intentDigest",
    "validatedAt",
  ].sort(),
);
const CUTOVER_MAX_FILE_BYTES = 128 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ACTOR_IDS = Object.freeze([
  "freed-runtime-observer",
  "freed-stability-controller",
  "freed-scaffolding-maintainer",
  "freed-nightly-runner",
  "freed-release-verifier",
]);
const CONTROL_PROCESS_PATTERNS = Object.freeze([
  "scripts/automation-control.mjs",
  "scripts/automation-actors.mjs",
  "scripts/nightly-self-improve.mjs",
  "scripts/outcome-ledger-repair.mjs",
  "scripts/record-outcome.mjs",
]);
const fatalDecoder = new TextDecoder("utf-8", { fatal: true });

function fail(code, message, details = undefined) {
  throw new AutomationControlError(code, message, details);
}

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

function deepFreezeJson(value) {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}

function immutableCanonicalJsonValue(value, code, message) {
  try {
    return deepFreezeJson(
      JSON.parse(fatalDecoder.decode(canonicalJsonBytes(value))),
    );
  } catch (error) {
    if (error instanceof AutomationControlError) throw error;
    fail(code, message);
  }
}

function prettyJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function assertAutomationKernelGuardCutoverPlanSize(
  bytes,
  maxBytes = AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES,
) {
  if (
    !Buffer.isBuffer(bytes) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES ||
    bytes.length > maxBytes
  ) {
    fail(
      "cutover_plan_too_large",
      `Kernel guard cutover plan exceeds the ${AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES.toLocaleString()} byte aggregate limit.`,
    );
  }
  return bytes;
}

function isCanonicalTimestamp(value) {
  if (typeof value !== "string") return false;
  const timestampMs = Date.parse(value);
  return (
    Number.isFinite(timestampMs) &&
    new Date(timestampMs).toISOString() === value
  );
}

function currentUid(stats = undefined) {
  return typeof process.getuid === "function"
    ? process.getuid()
    : (stats?.uid ?? 0);
}

function syncDirectory(directoryPath) {
  let descriptor;
  try {
    descriptor = openSync(directoryPath, constants.O_RDONLY);
    fsyncSync(descriptor);
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error?.code)) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function requirePrivateDirectory(directoryPath, label) {
  let stats;
  try {
    stats = lstatSync(directoryPath);
  } catch (error) {
    fail(
      "cutover_state_invalid",
      `${label} is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUid(stats) ||
    (stats.mode & 0o7777) !== 0o700 ||
    realpathSync(directoryPath) !== path.resolve(directoryPath)
  ) {
    fail(
      "cutover_state_invalid",
      `${label} must be a private canonical mode 0700 directory owned by the current user.`,
    );
  }
  return stats;
}

function ensurePrivateDirectory(
  directoryPath,
  beforeMutation = () => undefined,
) {
  if (existsSync(directoryPath)) {
    requirePrivateDirectory(directoryPath, directoryPath);
    syncDirectory(path.dirname(directoryPath));
    return;
  }
  const parent = path.dirname(directoryPath);
  if (parent !== directoryPath && !existsSync(parent)) {
    ensurePrivateDirectory(parent, beforeMutation);
  }
  beforeMutation();
  mkdirSync(directoryPath, { mode: 0o700 });
  beforeMutation();
  chmodSync(directoryPath, 0o700);
  syncDirectory(parent);
  requirePrivateDirectory(directoryPath, directoryPath);
}

function readBoundedRegularFile(
  filePath,
  maxBytes = CUTOVER_MAX_FILE_BYTES,
  allowedLinkCounts = new Set([1]),
  allowedModes = new Set([0o600, 0o640, 0o644]),
  admissionCheckpoint = () => undefined,
) {
  if (
    typeof constants.O_NOFOLLOW !== "number" ||
    typeof constants.O_NONBLOCK !== "number"
  ) {
    fail(
      "cutover_state_invalid",
      "Safe cutover file admission is unavailable.",
    );
  }
  let descriptor;
  try {
    const before = lstatSync(filePath);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.uid !== currentUid(before) ||
      !allowedModes.has(before.mode & 0o7777) ||
      !allowedLinkCounts.has(before.nlink) ||
      before.size < 0 ||
      before.size > maxBytes ||
      realpathSync(filePath) !== path.resolve(filePath)
    ) {
      fail(
        "cutover_state_invalid",
        `Cutover source file is unsafe: ${filePath}`,
      );
    }
    descriptor = openSync(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.uid !== before.uid ||
      opened.mode !== before.mode ||
      opened.size !== before.size ||
      !allowedLinkCounts.has(opened.nlink)
    ) {
      fail("cutover_state_invalid", `Cutover source file changed: ${filePath}`);
    }
    admissionCheckpoint({ filePath, descriptor, opened });
    const bytes = Buffer.alloc(opened.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (count === 0) break;
      offset += count;
    }
    const afterOpened = fstatSync(descriptor);
    const after = lstatSync(filePath);
    if (
      offset !== opened.size ||
      afterOpened.dev !== opened.dev ||
      afterOpened.ino !== opened.ino ||
      afterOpened.uid !== opened.uid ||
      afterOpened.mode !== opened.mode ||
      afterOpened.size !== opened.size ||
      !allowedLinkCounts.has(afterOpened.nlink) ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.uid !== opened.uid ||
      after.mode !== opened.mode ||
      !allowedLinkCounts.has(after.nlink) ||
      realpathSync(filePath) !== path.resolve(filePath)
    ) {
      fail("cutover_state_invalid", `Cutover source file changed: ${filePath}`);
    }
    return bytes.subarray(0, offset);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readPrivateMode600File(
  filePath,
  maxBytes = CUTOVER_MAX_FILE_BYTES,
  allowedLinkCounts = new Set([1]),
  admissionCheckpoint = () => undefined,
) {
  return readBoundedRegularFile(
    filePath,
    maxBytes,
    allowedLinkCounts,
    new Set([0o600]),
    admissionCheckpoint,
  );
}

function removePrivateTemporaryFile(
  filePath,
  beforeMutation = () => undefined,
) {
  if (!existsSync(filePath)) return;
  const stats = lstatSync(filePath);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUid(stats) ||
    (stats.mode & 0o7777) !== 0o600 ||
    realpathSync(filePath) !== path.resolve(filePath)
  ) {
    fail("cutover_conflict", `Cutover temporary path is unsafe: ${filePath}`);
  }
  beforeMutation();
  unlinkSync(filePath);
  syncDirectory(path.dirname(filePath));
}

function writeAtomic(filePath, bytes, beforeMutation = () => undefined) {
  ensurePrivateDirectory(path.dirname(filePath), beforeMutation);
  const temporaryPath = `${filePath}.cutover.tmp`;
  removePrivateTemporaryFile(temporaryPath, beforeMutation);
  let descriptor;
  try {
    beforeMutation();
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    beforeMutation();
    renameSync(temporaryPath, filePath);
    syncDirectory(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) beforeMutation();
    rmSync(temporaryPath, { force: true });
  }
}

function cutoverWriteAheadPath(plan) {
  return path.join(
    automationKernelGuardCutoverPaths(plan.parameters.stateRoot).controlRoot,
    "kernel-guard-cutover.write-ahead.json",
  );
}

function cutoverQuarantineRoot(plan) {
  return path.join(artifactDirectory(plan), ".recovery-quarantine");
}

function writeAheadIdentity(record) {
  return {
    schemaVersion: record.schemaVersion,
    kind: record.kind,
    operation: record.operation,
    scope: record.scope,
    scopeId: record.scopeId,
    cutoverId: record.cutoverId,
    operationName: record.operationName,
    filePath: record.filePath,
    quarantinePath: record.quarantinePath,
    sourceDev: record.sourceDev,
    sourceIno: record.sourceIno,
    sourceMode: record.sourceMode,
    targetMode: record.targetMode,
    sourceSize: record.sourceSize,
    sourceDigest: record.sourceDigest,
    sourceBytesBase64: record.sourceBytesBase64,
    targetSize: record.targetSize,
    targetDigest: record.targetDigest,
    targetBytesBase64: record.targetBytesBase64,
    sourceSnapshot: record.sourceSnapshot,
  };
}

function writeAheadOperationId(record) {
  return sha256(canonicalJsonBytes(writeAheadIdentity(record)));
}

function removalQuarantineId(record) {
  return sha256(
    canonicalJsonBytes({
      cutoverId: record.cutoverId,
      scope: record.scope,
      scopeId: record.scopeId,
      operationName: record.operationName,
      filePath: record.filePath,
      sourceDev: record.sourceDev,
      sourceIno: record.sourceIno,
      sourceDigest: record.sourceDigest,
    }),
  );
}

function exactWriteAheadKeys() {
  return [
    "cutoverId",
    "filePath",
    "kind",
    "operation",
    "operationId",
    "operationName",
    "phase",
    "preparedAt",
    "quarantinePath",
    "schemaVersion",
    "scope",
    "scopeId",
    "sourceBytesBase64",
    "sourceDev",
    "sourceDigest",
    "sourceIno",
    "sourceMode",
    "sourceSize",
    "sourceSnapshot",
    "targetBytesBase64",
    "targetDigest",
    "targetMode",
    "targetSize",
    "writtenAt",
  ].sort();
}

function writeAheadScope(plan, supersedePlan = undefined) {
  return supersedePlan === undefined
    ? { scope: "apply", scopeId: plan.parameters.cutoverId }
    : {
        scope: "supersede",
        scopeId: supersedePlan.parameters.supersedeId,
      };
}

function allowedRewritePaths(plan) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  return new Set([
    paths.writerLock,
    ...AUTOMATION_KERNEL_GUARD_NAMES.map((name) => paths.guards[name].owner),
  ]);
}

function pathIsStateDescendant(plan, candidatePath) {
  const stateRoot = plan.parameters.stateRoot;
  const relative = path.relative(stateRoot, candidatePath);
  return (
    path.isAbsolute(candidatePath) &&
    path.resolve(candidatePath) === candidatePath &&
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function validateWriteAheadRecord(plan, record, supersedePlan = undefined) {
  const expectedScope = writeAheadScope(plan, supersedePlan);
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const preparedAtMs = Date.parse(String(record?.preparedAt ?? ""));
  const writtenAtMs = Date.parse(String(record?.writtenAt ?? ""));
  if (
    record === null ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    Object.keys(record).sort().join("\n") !==
      exactWriteAheadKeys().join("\n") ||
    record.schemaVersion !== 1 ||
    record.kind !== CUTOVER_WRITE_AHEAD_KIND ||
    !["rewrite", "remove"].includes(record.operation) ||
    record.scope !== expectedScope.scope ||
    record.scopeId !== expectedScope.scopeId ||
    record.cutoverId !== plan.parameters.cutoverId ||
    !IDENTIFIER_PATTERN.test(String(record.operationName ?? "")) ||
    !SHA256_PATTERN.test(String(record.operationId ?? "")) ||
    writeAheadOperationId(record) !== record.operationId ||
    !pathIsStateDescendant(plan, record.filePath) ||
    !/^\d+$/.test(String(record.sourceDev ?? "")) ||
    !/^\d+$/.test(String(record.sourceIno ?? "")) ||
    ![0o600, 0o640, 0o644, 0o700, 0o755].includes(record.sourceMode) ||
    !Number.isSafeInteger(record.sourceSize) ||
    record.sourceSize < 0 ||
    !SHA256_PATTERN.test(String(record.sourceDigest ?? "")) ||
    !Number.isSafeInteger(record.targetSize) ||
    record.targetSize < 0 ||
    !SHA256_PATTERN.test(String(record.targetDigest ?? "")) ||
    !["prepared", "written"].includes(record.phase) ||
    !isCanonicalTimestamp(record.preparedAt) ||
    (record.phase === "prepared" && record.writtenAt !== null) ||
    (record.phase === "written" &&
      (!isCanonicalTimestamp(record.writtenAt) || writtenAtMs < preparedAtMs))
  ) {
    fail(
      "cutover_write_ahead_invalid",
      "Kernel guard cutover write-ahead record conflicts.",
    );
  }
  if (record.operation === "rewrite") {
    if (
      !allowedRewritePaths(plan).has(record.filePath) ||
      record.quarantinePath !== null ||
      record.sourceSnapshot !== null ||
      ![0o600, 0o640, 0o644].includes(record.targetMode) ||
      typeof record.sourceBytesBase64 !== "string" ||
      typeof record.targetBytesBase64 !== "string"
    ) {
      fail(
        "cutover_write_ahead_invalid",
        "Kernel guard rewrite record has an unsafe target.",
      );
    }
    const sourceBytes = Buffer.from(record.sourceBytesBase64, "base64");
    const targetBytes = Buffer.from(record.targetBytesBase64, "base64");
    if (
      sourceBytes.toString("base64") !== record.sourceBytesBase64 ||
      targetBytes.toString("base64") !== record.targetBytesBase64 ||
      sourceBytes.length !== record.sourceSize ||
      targetBytes.length !== record.targetSize ||
      sha256(sourceBytes) !== record.sourceDigest ||
      sha256(targetBytes) !== record.targetDigest
    ) {
      fail(
        "cutover_write_ahead_invalid",
        "Kernel guard rewrite bytes are not exact.",
      );
    }
  } else {
    const expectedQuarantine = path.join(
      cutoverQuarantineRoot(plan),
      removalQuarantineId(record),
    );
    if (
      record.targetMode !== null ||
      record.sourceBytesBase64 !== null ||
      record.targetBytesBase64 !== null ||
      record.targetSize !== 0 ||
      record.targetDigest !== sha256(Buffer.alloc(0)) ||
      record.sourceSnapshot === null ||
      typeof record.sourceSnapshot !== "object" ||
      record.sourceSnapshot.path !== record.filePath ||
      sha256(canonicalJsonBytes(record.sourceSnapshot)) !==
        record.sourceDigest ||
      record.sourceSize !== canonicalJsonBytes(record.sourceSnapshot).length ||
      record.quarantinePath !== expectedQuarantine ||
      !pathIsStateDescendant(plan, record.quarantinePath) ||
      !(
        record.filePath === paths.writerLock ||
        record.filePath === paths.transaction ||
        record.filePath.startsWith(`${paths.guardsRoot}${path.sep}`)
      )
    ) {
      fail(
        "cutover_write_ahead_invalid",
        "Kernel guard removal record has an unsafe target.",
      );
    }
  }
  return record;
}

function readWriteAheadRecord(plan, supersedePlan = undefined) {
  const filePath = cutoverWriteAheadPath(plan);
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    supersedePlan,
    extraPaths: [filePath, `${filePath}.cutover.tmp`],
  });
  if (!existsSync(filePath)) {
    syncDirectory(path.dirname(filePath));
    return null;
  }
  let record;
  try {
    record = JSON.parse(
      fatalDecoder.decode(
        readPrivateMode600File(filePath, CUTOVER_WRITE_AHEAD_MAX_BYTES),
      ),
    );
  } catch (error) {
    if (error instanceof AutomationControlError) throw error;
    fail(
      "cutover_write_ahead_invalid",
      "Kernel guard cutover write-ahead record is malformed.",
    );
  }
  const validated = validateWriteAheadRecord(
    plan,
    record,
    supersedePlan !== undefined && record?.scope === "supersede"
      ? supersedePlan
      : undefined,
  );
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    supersedePlan,
    extraPaths: [
      validated.filePath,
      ...(validated.quarantinePath === null
        ? []
        : [validated.quarantinePath]),
    ],
  });
  return validated;
}

function requireSupersedeWriteAheadScope(record) {
  if (record?.scope === "apply") {
    fail(
      "cutover_supersede_conflict",
      "Pending cutover application recovery must resume under its original plan before supersession.",
    );
  }
  return record;
}

function writeAheadFilesystemPaths(record) {
  if (record === null) return [];
  return [
    record.filePath,
    ...(record.quarantinePath === null ? [] : [record.quarantinePath]),
  ];
}

function writeWriteAheadRecord(
  plan,
  record,
  supersedePlan = undefined,
  beforeMutation = () => undefined,
) {
  validateWriteAheadRecord(plan, record, supersedePlan);
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    supersedePlan,
    extraPaths: [
      cutoverWriteAheadPath(plan),
      record.filePath,
      ...(record.quarantinePath === null ? [] : [record.quarantinePath]),
    ],
  });
  const bytes = prettyJsonBytes(record);
  if (bytes.length > CUTOVER_WRITE_AHEAD_MAX_BYTES) {
    fail(
      "cutover_write_ahead_invalid",
      "Kernel guard cutover write-ahead record exceeds its private size boundary.",
    );
  }
  writeAtomic(cutoverWriteAheadPath(plan), bytes, beforeMutation);
}

function clearWriteAheadRecord(
  plan,
  checkpoint,
  checkpointName,
  details = {},
  beforeMutation = () => undefined,
) {
  const filePath = cutoverWriteAheadPath(plan);
  if (existsSync(filePath)) {
    beforeMutation();
    unlinkSync(filePath);
    checkpoint(checkpointName, { ...details, writeAheadPath: filePath });
  }
  syncDirectory(path.dirname(filePath));
}

function writeImmutable(
  filePath,
  bytes,
  {
    checkpoint = () => undefined,
    linkedCheckpointName = "",
    beforeMutation = () => undefined,
    beforeFinalize = () => undefined,
  } = {},
) {
  ensurePrivateDirectory(path.dirname(filePath), beforeMutation);
  const temporaryPath = `${filePath}.cutover.tmp`;
  if (existsSync(filePath)) {
    if (existsSync(temporaryPath)) {
      const finalStats = lstatSync(filePath);
      const temporaryStats = lstatSync(temporaryPath);
      if (
        finalStats.isFile() &&
        temporaryStats.isFile() &&
        finalStats.dev === temporaryStats.dev &&
        finalStats.ino === temporaryStats.ino &&
        finalStats.nlink === 2 &&
        temporaryStats.nlink === 2 &&
        readBoundedRegularFile(filePath, bytes.length, new Set([2])).equals(
          bytes,
        )
      ) {
        beforeFinalize();
        const recoveredFinal = lstatSync(filePath);
        const recoveredTemporary = lstatSync(temporaryPath);
        if (
          recoveredFinal.dev !== recoveredTemporary.dev ||
          recoveredFinal.ino !== recoveredTemporary.ino ||
          recoveredFinal.nlink !== 2 ||
          recoveredTemporary.nlink !== 2 ||
          !readPrivateMode600File(
            filePath,
            bytes.length,
            new Set([2]),
          ).equals(bytes)
        ) {
          fail(
            "cutover_conflict",
            `Cutover artifact changed before link finalization at ${filePath}.`,
          );
        }
        beforeMutation();
        unlinkSync(temporaryPath);
        syncDirectory(path.dirname(filePath));
      } else {
        fail(
          "cutover_conflict",
          `Cutover artifact recovery conflicts at ${filePath}.`,
        );
      }
    }
    const existing = readPrivateMode600File(filePath, bytes.length);
    if (!existing.equals(bytes)) {
      fail("cutover_conflict", `Cutover artifact conflicts at ${filePath}.`);
    }
    syncDirectory(path.dirname(filePath));
    return;
  }
  let descriptor;
  try {
    if (existsSync(temporaryPath)) {
      let reusable = false;
      try {
        reusable = readPrivateMode600File(temporaryPath, bytes.length).equals(
          bytes,
        );
      } catch {
        reusable = false;
      }
      if (!reusable) {
        removePrivateTemporaryFile(temporaryPath, beforeMutation);
      }
    }
    if (!existsSync(temporaryPath)) {
      beforeMutation();
      descriptor = openSync(
        temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o600,
      );
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
    }
    try {
      beforeMutation();
      linkSync(temporaryPath, filePath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = readPrivateMode600File(
        filePath,
        bytes.length,
        new Set([1, 2]),
      );
      if (!existing.equals(bytes)) {
        fail("cutover_conflict", `Cutover artifact conflicts at ${filePath}.`);
      }
    }
    const finalStats = lstatSync(filePath);
    const temporaryStats = lstatSync(temporaryPath);
    if (
      finalStats.dev !== temporaryStats.dev ||
      finalStats.ino !== temporaryStats.ino
    ) {
      fail(
        "cutover_conflict",
        `Cutover artifact link identity conflicts at ${filePath}.`,
      );
    }
    if (linkedCheckpointName !== "") {
      checkpoint(linkedCheckpointName, { filePath, temporaryPath });
    }
    beforeFinalize();
    const finalBeforeUnlink = lstatSync(filePath);
    const temporaryBeforeUnlink = lstatSync(temporaryPath);
    if (
      finalBeforeUnlink.dev !== temporaryBeforeUnlink.dev ||
      finalBeforeUnlink.ino !== temporaryBeforeUnlink.ino ||
      finalBeforeUnlink.nlink !== 2 ||
      temporaryBeforeUnlink.nlink !== 2 ||
      !readPrivateMode600File(
        filePath,
        bytes.length,
        new Set([2]),
      ).equals(bytes)
    ) {
      fail(
        "cutover_conflict",
        `Cutover artifact changed before link finalization at ${filePath}.`,
      );
    }
    beforeMutation();
    unlinkSync(temporaryPath);
    syncDirectory(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function requireImmutableTargetPreflight(filePath, bytes) {
  const temporaryPath = `${filePath}.cutover.tmp`;
  const finalExists = existsSync(filePath);
  const temporaryExists = existsSync(temporaryPath);
  if (!finalExists && !temporaryExists) return;
  if (finalExists && temporaryExists) {
    const finalStats = lstatSync(filePath);
    const temporaryStats = lstatSync(temporaryPath);
    if (
      !finalStats.isFile() ||
      !temporaryStats.isFile() ||
      finalStats.isSymbolicLink() ||
      temporaryStats.isSymbolicLink() ||
      finalStats.dev !== temporaryStats.dev ||
      finalStats.ino !== temporaryStats.ino ||
      finalStats.nlink !== 2 ||
      temporaryStats.nlink !== 2 ||
      !readPrivateMode600File(filePath, bytes.length, new Set([2])).equals(
        bytes,
      )
    ) {
      fail(
        "cutover_conflict",
        `Cutover artifact recovery conflicts at ${filePath}.`,
      );
    }
    return;
  }
  if (finalExists) {
    if (!readPrivateMode600File(filePath, bytes.length).equals(bytes)) {
      fail("cutover_conflict", `Cutover artifact conflicts at ${filePath}.`);
    }
    return;
  }
  if (!readPrivateMode600File(temporaryPath, bytes.length).equals(bytes)) {
    fail(
      "cutover_conflict",
      `Cutover artifact temporary bytes conflict at ${filePath}.`,
    );
  }
}

function requireIdentifier(value, label) {
  if (!IDENTIFIER_PATTERN.test(String(value ?? ""))) {
    fail("cutover_argument_invalid", `${label} is invalid.`);
  }
  return String(value);
}

function requireSha(value, label) {
  if (!SHA256_PATTERN.test(String(value ?? ""))) {
    fail("cutover_argument_invalid", `${label} must be one SHA-256 digest.`);
  }
  return String(value);
}

function archivedEvidencePaths(entry, targetPath) {
  if (entry?.kind === "missing") return [targetPath];
  if (entry?.kind === "file") return [targetPath, `${targetPath}.cutover.tmp`];
  if (entry?.kind !== "directory" || !Array.isArray(entry.entries)) {
    return [targetPath];
  }
  return [
    targetPath,
    ...entry.entries.flatMap((child) =>
      archivedEvidencePaths(child, path.join(targetPath, path.basename(child.path))),
    ),
  ];
}

function exactCutoverEvidenceFilesystemPaths(
  plan,
  { supersedePlan = undefined, transaction = undefined } = {},
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const directory = artifactDirectory(plan);
  const legacyRoot = path.join(directory, "legacy-paths");
  const authorizations = path.join(directory, "authorizations");
  const candidates = [
    directory,
    path.join(directory, "plan.json"),
    path.join(directory, "source-snapshot.json"),
    path.join(directory, "legacy-locks.json"),
    legacyRoot,
    path.join(directory, "receipt.json"),
    authorizations,
    path.join(authorizations, "prepared-authorization.json"),
    cutoverQuarantineRoot(plan),
    ...archivedEvidencePaths(
      sourceEntry(plan, paths.writerLock),
      path.join(legacyRoot, "outcomes.jsonl.writer-lock"),
    ),
    ...archivedEvidencePaths(
      sourceEntry(plan, paths.guardsRoot),
      path.join(legacyRoot, "guards"),
    ),
  ];
  if (Array.isArray(transaction?.authorizations)) {
    candidates.push(
      ...transaction.authorizations
        .map((authorization) => authorization?.confirmationArtifact)
        .filter((filePath) => typeof filePath === "string"),
    );
  }
  if (supersedePlan !== undefined) {
    const evidence = supersedeEvidencePaths(plan, supersedePlan);
    candidates.push(
      path.dirname(evidence.directory),
      evidence.directory,
      evidence.plan,
      evidence.transaction,
      evidence.receipt,
    );
  }
  return candidates.flatMap((filePath) => [filePath, `${filePath}.cutover.tmp`]);
}

export function inspectAutomationKernelGuardCutoverFilesystemAdmission(
  {
    stateRoot,
    plan = undefined,
    supersedePlan = undefined,
    transaction = undefined,
    extraPaths = [],
  },
  { resolveFilesystemType = undefined } = {},
) {
  const paths = automationKernelGuardCutoverPaths(stateRoot);
  return inspectAutomationKernelGuardFilesystemPaths(
    paths.stateRoot,
    [
      paths.stateRoot,
      paths.controlRoot,
      paths.guardsRoot,
      paths.globalReceipt,
      `${paths.globalReceipt}.cutover.tmp`,
      paths.transaction,
      `${paths.transaction}.cutover.tmp`,
      paths.writeAhead,
      `${paths.writeAhead}.cutover.tmp`,
      paths.bootstrapLock,
      `${paths.bootstrapLock}.cutover.tmp`,
      paths.writerLock,
      `${paths.writerLock}.cutover.tmp`,
      `${paths.writerLock}.cutover-claim.tmp`,
      path.dirname(paths.artifactRoot),
      paths.artifactRoot,
      ...AUTOMATION_KERNEL_GUARD_NAMES.flatMap((name) => {
        const guard = paths.guards[name];
        return [
          guard.directory,
          guard.owner,
          `${guard.owner}.cutover.tmp`,
          `${guard.owner}.cutover-claim.tmp`,
          guard.inner,
          `${guard.inner}.cutover.tmp`,
        ];
      }),
      ...(plan === undefined
        ? []
        : exactCutoverEvidenceFilesystemPaths(plan, {
            supersedePlan,
            transaction,
          })),
      ...extraPaths,
    ],
    { resolveFilesystemType },
  );
}

export function assertAutomationKernelGuardCutoverFilesystemAdmission(
  {
    stateRoot,
    plan = undefined,
    supersedePlan = undefined,
    transaction = undefined,
    extraPaths = [],
  },
  options = {},
) {
  const inspection = inspectAutomationKernelGuardCutoverFilesystemAdmission(
    { stateRoot, plan, supersedePlan, transaction, extraPaths },
    options,
  );
  if (!inspection.ready) {
    fail(
      "cutover_filesystem_unsupported",
      `Kernel guard cutover requires one admitted local filesystem: ${inspection.problems.join("; ")}`,
    );
  }
  return inspection;
}

function requireLocalFilesystem(
  stateRoot,
  {
    plan = undefined,
    supersedePlan = undefined,
    transaction = undefined,
    extraPaths = [],
  } = {},
) {
  return assertAutomationKernelGuardCutoverFilesystemAdmission({
    stateRoot,
    plan,
    supersedePlan,
    transaction,
    extraPaths,
  });
}

function gitOutput(repoRoot, args) {
  return execFileSync("/usr/bin/git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  }).trim();
}

function exactDevIdentity(repoRoot) {
  const canonicalRepoRoot = realpathSync(repoRoot);
  if (
    gitOutput(canonicalRepoRoot, ["rev-parse", "--show-toplevel"]) !==
    canonicalRepoRoot
  ) {
    fail("cutover_repo_invalid", "Cutover repo root is not canonical.");
  }
  if (
    gitOutput(canonicalRepoRoot, [
      "status",
      "--porcelain",
      "--untracked-files=all",
    ]) !== ""
  ) {
    fail(
      "cutover_repo_dirty",
      "Kernel guard cutover requires a clean exact dev worktree.",
    );
  }
  const headSha = gitOutput(canonicalRepoRoot, ["rev-parse", "HEAD"]);
  const devSha = gitOutput(canonicalRepoRoot, ["rev-parse", "origin/dev"]);
  if (headSha !== devSha) {
    fail(
      "cutover_repo_stale",
      "Kernel guard cutover requires HEAD to equal origin/dev.",
    );
  }
  return { repoRoot: canonicalRepoRoot, sourceCodeSha: headSha };
}

function automationTomlPaths(codexHome) {
  return Object.fromEntries(
    ACTOR_IDS.map((actor) => [
      actor,
      path.join(codexHome, "automations", actor, "automation.toml"),
    ]),
  );
}

function requirePausedActors(codexHome) {
  const result = {};
  for (const [actor, automationPath] of Object.entries(
    automationTomlPaths(codexHome),
  )) {
    const bytes = readBoundedRegularFile(automationPath, 1024 * 1024);
    let text;
    try {
      text = fatalDecoder.decode(bytes);
    } catch {
      fail("cutover_actor_invalid", `Saved actor ${actor} is not fatal UTF-8.`);
    }
    const matches = [...text.matchAll(/^status\s*=\s*"([^"]+)"\s*$/gm)];
    if (matches.length !== 1 || matches[0][1] !== "PAUSED") {
      fail(
        "cutover_actor_active",
        `Saved actor ${actor} must be exactly PAUSED before cutover.`,
      );
    }
    result[actor] = { path: automationPath, digest: sha256(bytes) };
  }
  return result;
}

function snapshotPath(
  targetPath,
  { includeBytes = true, maxBytes = CUTOVER_MAX_FILE_BYTES } = {},
) {
  if (!existsSync(targetPath)) return { path: targetPath, kind: "missing" };
  const stats = lstatSync(targetPath);
  if (stats.isSymbolicLink()) {
    fail(
      "cutover_state_invalid",
      `Cutover source path is a symlink: ${targetPath}`,
    );
  }
  if (stats.isDirectory()) {
    if (
      stats.uid !== currentUid(stats) ||
      ![0o700, 0o755].includes(stats.mode & 0o7777) ||
      realpathSync(targetPath) !== path.resolve(targetPath)
    ) {
      fail(
        "cutover_state_invalid",
        `Cutover source directory is unsafe: ${targetPath}`,
      );
    }
    return {
      path: targetPath,
      kind: "directory",
      mode: stats.mode & 0o7777,
      entries: readdirSync(targetPath)
        .sort()
        .map((name) =>
          snapshotPath(path.join(targetPath, name), {
            includeBytes,
            maxBytes,
          }),
        ),
    };
  }
  if (!stats.isFile()) {
    fail(
      "cutover_state_invalid",
      `Cutover source path is not regular: ${targetPath}`,
    );
  }
  const bytes = readBoundedRegularFile(targetPath, maxBytes);
  return {
    path: targetPath,
    kind: "file",
    mode: stats.mode & 0o7777,
    size: bytes.length,
    digest: sha256(bytes),
    ...(includeBytes ? { bytesBase64: bytes.toString("base64") } : {}),
  };
}

function requireLegacySourceShape(paths, entries) {
  const writer = entries.find((entry) => entry.path === paths.writerLock);
  if (!writer || !["missing", "file"].includes(writer.kind)) {
    fail(
      "cutover_state_invalid",
      "The legacy outcome writer path has an unsupported shape.",
    );
  }
  const guards = entries.find((entry) => entry.path === paths.guardsRoot);
  if (guards?.kind !== "directory") {
    fail("cutover_state_invalid", "The legacy guard root is unavailable.");
  }
  const canonicalNames = new Set(
    AUTOMATION_KERNEL_GUARD_NAMES.map((name) => `${name}.lock`),
  );
  for (const entry of guards.entries) {
    const name = path.basename(entry.path);
    const abandonedBase = [...canonicalNames].find((candidate) =>
      name.startsWith(`${candidate}.abandoned.`),
    );
    if (
      entry.kind !== "directory" ||
      (!canonicalNames.has(name) && abandonedBase === undefined)
    ) {
      fail(
        "cutover_state_invalid",
        `Legacy guard entry has an unsupported shape: ${entry.path}`,
      );
    }
  }
}

function snapshotCutoverSource({ stateRoot, codexHome, repoRoot }) {
  const paths = automationKernelGuardCutoverPaths(stateRoot);
  requirePrivateDirectory(paths.stateRoot, "Automation state root");
  requirePrivateDirectory(paths.controlRoot, "Automation control root");
  requirePrivateDirectory(paths.guardsRoot, "Automation guard root");
  const repo = exactDevIdentity(repoRoot);
  const actors = requirePausedActors(codexHome);
  const entries = [
    snapshotPath(path.join(paths.controlRoot, "current-tasks.json")),
    snapshotPath(path.join(paths.controlRoot, "events.jsonl"), {
      includeBytes: false,
    }),
    snapshotPath(path.join(paths.stateRoot, "outcomes.jsonl"), {
      includeBytes: false,
      maxBytes: 16 * 1024 * 1024,
    }),
    snapshotPath(path.join(paths.controlRoot, "leases")),
    snapshotPath(paths.guardsRoot),
    snapshotPath(paths.writerLock),
    ...Object.values(actors).map((actor) => snapshotPath(actor.path)),
  ];
  requireLegacySourceShape(paths, entries);
  const legacyEntries = entries.filter(
    (entry) =>
      entry.path === paths.writerLock || entry.path === paths.guardsRoot,
  );
  const snapshot = {
    schemaVersion: 1,
    stateRoot: paths.stateRoot,
    codexHome,
    repoRoot: repo.repoRoot,
    sourceCodeSha: repo.sourceCodeSha,
    actors,
    entries,
  };
  return {
    snapshot,
    snapshotDigest: sha256(canonicalJsonBytes(snapshot)),
    archiveManifestDigest: sha256(
      canonicalJsonBytes({ schemaVersion: 1, entries: legacyEntries }),
    ),
  };
}

function requireCanonicalTask(snapshot, taskId) {
  const manifestEntry = snapshot.entries.find((entry) =>
    entry.path.endsWith("/control/current-tasks.json"),
  );
  const inspection = inspectAutomationKernelGuardCanonicalTaskSource(
    manifestEntry,
    taskId,
  );
  if (!inspection.ready) {
    const missing = inspection.problems.some((problem) =>
      problem.includes(`Canonical task ${taskId} does not exist`),
    );
    fail(
      missing ? "cutover_task_missing" : "cutover_task_invalid",
      `Canonical task admission failed: ${inspection.problems.join("; ")}`,
    );
  }
}

function cutoverParameters({
  stateRoot,
  codexHome,
  repoRoot,
  sourceCodeSha,
  sourceSnapshotDigest,
  archiveManifestDigest,
  cutoverId,
}) {
  return {
    schemaVersion: 1,
    policy: AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
    stateRoot,
    codexHome,
    repoRoot,
    sourceCodeSha,
    sourceSnapshotDigest,
    archiveManifestDigest,
    cutoverId,
    markerDigest: AUTOMATION_KERNEL_GUARD_MARKER_DIGEST,
    guardNames: [...AUTOMATION_KERNEL_GUARD_NAMES],
  };
}

function cutoverIdFor({
  taskId,
  sourceSnapshotDigest,
  archiveManifestDigest,
  sourceCodeSha,
}) {
  return sha256(
    canonicalJsonBytes({
      policy: AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
      taskId,
      sourceSnapshotDigest,
      archiveManifestDigest,
      sourceCodeSha,
    }),
  );
}

export function planAutomationKernelGuardCutover({
  stateRoot,
  taskId,
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  repoRoot = REPO_ROOT,
  nowMs = Date.now(),
}) {
  const canonicalStateRoot = realpathSync(stateRoot);
  const canonicalCodexHome = realpathSync(codexHome);
  requireLocalFilesystem(canonicalStateRoot);
  const normalizedTaskId = requireIdentifier(taskId, "taskId");
  const source = snapshotCutoverSource({
    stateRoot: canonicalStateRoot,
    codexHome: canonicalCodexHome,
    repoRoot,
  });
  requireCanonicalTask(source.snapshot, normalizedTaskId);
  const cutoverId = cutoverIdFor({
    taskId: normalizedTaskId,
    sourceSnapshotDigest: source.snapshotDigest,
    archiveManifestDigest: source.archiveManifestDigest,
    sourceCodeSha: source.snapshot.sourceCodeSha,
  });
  const parameters = cutoverParameters({
    stateRoot: canonicalStateRoot,
    codexHome: canonicalCodexHome,
    repoRoot: source.snapshot.repoRoot,
    sourceCodeSha: source.snapshot.sourceCodeSha,
    sourceSnapshotDigest: source.snapshotDigest,
    archiveManifestDigest: source.archiveManifestDigest,
    cutoverId,
  });
  const intent = {
    schemaVersion: 1,
    action: CUTOVER_ACTION,
    taskId: normalizedTaskId,
    parameters,
  };
  const plan = normalizePlan({
    schemaVersion: CUTOVER_SCHEMA_VERSION,
    kind: CUTOVER_PLAN_KIND,
    action: "automation-guard.cutover.plan",
    createdAt: new Date(nowMs).toISOString(),
    taskId: normalizedTaskId,
    parameters,
    sourceSnapshot: source.snapshot,
    intent,
    intentDigest: ownerGovernanceIntentDigest(intent),
  });
  requireLocalFilesystem(canonicalStateRoot, { plan });
  return plan;
}

function normalizePlan(rawPlan) {
  const plan = immutableCanonicalJsonValue(
    rawPlan,
    "cutover_plan_invalid",
    "Kernel guard cutover plan is invalid.",
  );
  assertAutomationKernelGuardCutoverPlanSize(prettyJsonBytes(plan));
  if (
    plan?.schemaVersion !== CUTOVER_SCHEMA_VERSION ||
    plan?.kind !== CUTOVER_PLAN_KIND ||
    plan?.action !== "automation-guard.cutover.plan" ||
    !IDENTIFIER_PATTERN.test(String(plan?.taskId ?? "")) ||
    plan?.intent?.action !== CUTOVER_ACTION ||
    plan.intent.taskId !== plan.taskId ||
    stableJson(plan.intent.parameters) !== stableJson(plan.parameters) ||
    ownerGovernanceIntentDigest(plan.intent) !== plan.intentDigest ||
    plan.parameters?.policy !== AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY ||
    !SHA256_PATTERN.test(String(plan.parameters?.cutoverId ?? "")) ||
    plan.parameters?.markerDigest !== AUTOMATION_KERNEL_GUARD_MARKER_DIGEST ||
    !Array.isArray(plan.parameters?.guardNames) ||
    plan.parameters.guardNames.join("\n") !==
      AUTOMATION_KERNEL_GUARD_NAMES.join("\n") ||
    !SHA256_PATTERN.test(String(plan.parameters?.sourceSnapshotDigest ?? "")) ||
    !SHA256_PATTERN.test(
      String(plan.parameters?.archiveManifestDigest ?? ""),
    ) ||
    !GIT_OBJECT_ID_PATTERN.test(String(plan.parameters?.sourceCodeSha ?? "")) ||
    sha256(canonicalJsonBytes(plan.sourceSnapshot)) !==
      plan.parameters.sourceSnapshotDigest
  ) {
    fail("cutover_plan_invalid", "Kernel guard cutover plan is invalid.");
  }
  const expectedPlanKeys = [
    "action",
    "createdAt",
    "intent",
    "intentDigest",
    "kind",
    "parameters",
    "schemaVersion",
    "sourceSnapshot",
    "taskId",
  ].sort();
  const expectedParameterKeys = [
    "archiveManifestDigest",
    "codexHome",
    "cutoverId",
    "guardNames",
    "markerDigest",
    "policy",
    "repoRoot",
    "schemaVersion",
    "sourceCodeSha",
    "sourceSnapshotDigest",
    "stateRoot",
  ].sort();
  const expectedIntentKeys = [
    "action",
    "parameters",
    "schemaVersion",
    "taskId",
  ].sort();
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const expectedArchiveDigest = sha256(
    canonicalJsonBytes(legacyManifest(plan)),
  );
  const expectedCutoverId = cutoverIdFor({
    taskId: plan.taskId,
    sourceSnapshotDigest: plan.parameters.sourceSnapshotDigest,
    archiveManifestDigest: plan.parameters.archiveManifestDigest,
    sourceCodeSha: plan.parameters.sourceCodeSha,
  });
  if (
    Object.keys(plan).sort().join("\n") !== expectedPlanKeys.join("\n") ||
    Object.keys(plan.parameters).sort().join("\n") !==
      expectedParameterKeys.join("\n") ||
    Object.keys(plan.intent).sort().join("\n") !==
      expectedIntentKeys.join("\n") ||
    plan.parameters.schemaVersion !== 1 ||
    plan.intent.schemaVersion !== 1 ||
    !isCanonicalTimestamp(plan.createdAt) ||
    plan.parameters.stateRoot !== paths.stateRoot ||
    plan.sourceSnapshot?.stateRoot !== plan.parameters.stateRoot ||
    plan.sourceSnapshot?.codexHome !== plan.parameters.codexHome ||
    plan.sourceSnapshot?.repoRoot !== plan.parameters.repoRoot ||
    plan.sourceSnapshot?.sourceCodeSha !== plan.parameters.sourceCodeSha ||
    expectedArchiveDigest !== plan.parameters.archiveManifestDigest ||
    expectedCutoverId !== plan.parameters.cutoverId
  ) {
    fail(
      "cutover_plan_invalid",
      "Kernel guard cutover plan is cross-bound inconsistently.",
    );
  }
  requireCanonicalTask(plan.sourceSnapshot, plan.taskId);
  return plan;
}

function currentCanonicalTask(plan) {
  const manifestPath = path.join(
    plan.parameters.stateRoot,
    "control",
    "current-tasks.json",
  );
  let manifest;
  let manifestBytes;
  try {
    manifestBytes = readBoundedRegularFile(manifestPath, 16 * 1024 * 1024);
    manifest = JSON.parse(fatalDecoder.decode(manifestBytes));
  } catch {
    fail(
      "cutover_task_missing",
      "Canonical task manifest is unavailable for cutover supersession.",
    );
  }
  requireCanonicalTask(
    {
      entries: [
        {
          path: manifestPath,
          kind: "file",
          bytesBase64: manifestBytes.toString("base64"),
        },
      ],
    },
    plan.taskId,
  );
  const matches = Array.isArray(manifest?.tasks)
    ? manifest.tasks.filter((task) => task?.taskId === plan.taskId)
    : [];
  if (matches.length !== 1) {
    fail(
      "cutover_task_missing",
      `Canonical task ${plan.taskId} is not uniquely present.`,
    );
  }
  return matches[0];
}

function exactTransactionRecord(plan) {
  const transaction = readTransaction(plan);
  if (transaction === null) return null;
  const bytes = readPrivateMode600File(transactionPath(plan), 1024 * 1024);
  if (!bytes.equals(prettyJsonBytes(transaction))) {
    fail(
      "cutover_transaction_invalid",
      "Kernel guard cutover transaction bytes are not canonical.",
    );
  }
  return { transaction, bytes };
}

function supersedeIdFor(parameters) {
  return sha256(
    canonicalJsonBytes({
      action: CUTOVER_SUPERSEDE_ACTION,
      archiveManifestDigest: parameters.archiveManifestDigest,
      claimGenerationsDigest: parameters.claimGenerationsDigest,
      currentTaskDigest: parameters.currentTaskDigest,
      cutoverId: parameters.cutoverId,
      oldPlanDigest: parameters.oldPlanDigest,
      sourceSnapshotDigest: parameters.sourceSnapshotDigest,
      stateRoot: parameters.stateRoot,
      taskId: parameters.taskId,
      transactionDigest: parameters.transactionDigest,
      transactionPhase: parameters.transactionPhase,
    }),
  );
}

function normalizeSupersedePlan(rawPlan, oldPlan) {
  const plan = immutableCanonicalJsonValue(
    rawPlan,
    "cutover_supersede_plan_invalid",
    "Kernel guard cutover supersede plan is invalid or inconsistently bound.",
  );
  assertAutomationKernelGuardCutoverPlanSize(prettyJsonBytes(plan));
  const expectedPlanKeys = [
    "action",
    "createdAt",
    "currentTask",
    "intent",
    "intentDigest",
    "kind",
    "parameters",
    "schemaVersion",
    "taskId",
  ].sort();
  const expectedParameterKeys = [
    "archiveManifestDigest",
    "claimGenerationsDigest",
    "currentTaskDigest",
    "cutoverId",
    "oldPlanDigest",
    "policy",
    "schemaVersion",
    "sourceSnapshotDigest",
    "stateRoot",
    "supersedeId",
    "taskId",
    "transactionDigest",
    "transactionPhase",
  ].sort();
  const expectedIntentKeys = [
    "action",
    "parameters",
    "schemaVersion",
    "taskId",
  ].sort();
  const oldPlanDigest = sha256(canonicalJsonBytes(oldPlan));
  const expectedSupersedeId = supersedeIdFor(plan?.parameters ?? {});
  if (
    plan?.schemaVersion !== 1 ||
    plan?.kind !== CUTOVER_SUPERSEDE_PLAN_KIND ||
    plan?.action !== "automation-guard.cutover.supersede.plan" ||
    plan?.taskId !== oldPlan.taskId ||
    !isCanonicalTimestamp(plan?.createdAt) ||
    Object.keys(plan).sort().join("\n") !== expectedPlanKeys.join("\n") ||
    Object.keys(plan?.parameters ?? {})
      .sort()
      .join("\n") !== expectedParameterKeys.join("\n") ||
    Object.keys(plan?.intent ?? {})
      .sort()
      .join("\n") !== expectedIntentKeys.join("\n") ||
    plan.parameters.schemaVersion !== 1 ||
    plan.parameters.policy !== AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY ||
    plan.parameters.taskId !== plan.taskId ||
    plan.parameters.stateRoot !== oldPlan.parameters.stateRoot ||
    plan.parameters.cutoverId !== oldPlan.parameters.cutoverId ||
    plan.parameters.oldPlanDigest !== oldPlanDigest ||
    plan.parameters.sourceSnapshotDigest !==
      oldPlan.parameters.sourceSnapshotDigest ||
    plan.parameters.archiveManifestDigest !==
      oldPlan.parameters.archiveManifestDigest ||
    !["prepared", "claims-installed"].includes(
      plan.parameters.transactionPhase,
    ) ||
    !SHA256_PATTERN.test(String(plan.parameters.transactionDigest ?? "")) ||
    !SHA256_PATTERN.test(
      String(plan.parameters.claimGenerationsDigest ?? ""),
    ) ||
    !SHA256_PATTERN.test(String(plan.parameters.currentTaskDigest ?? "")) ||
    plan.parameters.supersedeId !== expectedSupersedeId ||
    sha256(canonicalJsonBytes(plan.currentTask)) !==
      plan.parameters.currentTaskDigest ||
    plan.currentTask?.taskId !== plan.taskId ||
    plan.intent?.schemaVersion !== 1 ||
    plan.intent.action !== CUTOVER_SUPERSEDE_ACTION ||
    plan.intent.taskId !== plan.taskId ||
    stableJson(plan.intent.parameters) !== stableJson(plan.parameters) ||
    ownerGovernanceIntentDigest(plan.intent) !== plan.intentDigest
  ) {
    fail(
      "cutover_supersede_plan_invalid",
      "Kernel guard cutover supersede plan is invalid or inconsistently bound.",
    );
  }
  return plan;
}

function permanentTargetMarkerPaths(oldPlan) {
  const paths = automationKernelGuardCutoverPaths(oldPlan.parameters.stateRoot);
  return [
    paths.writerLock,
    ...AUTOMATION_KERNEL_GUARD_NAMES.flatMap((name) => {
      const guard = paths.guards[name];
      return [guard.owner, guard.inner];
    }),
  ];
}

function fileContainsMarker(filePath) {
  if (!existsSync(filePath)) return false;
  try {
    return readBoundedRegularFile(
      filePath,
      automationKernelGuardMarkerBytes().length,
      new Set([1, 2]),
    ).equals(automationKernelGuardMarkerBytes());
  } catch {
    return false;
  }
}

function requireSupersedeStillPreMarker(oldPlan) {
  const paths = automationKernelGuardCutoverPaths(oldPlan.parameters.stateRoot);
  if (existsSync(paths.globalReceipt)) {
    fail(
      "cutover_supersede_too_late",
      "An activated kernel guard cutover cannot be superseded.",
    );
  }
  const markerPath = permanentTargetMarkerPaths(oldPlan).find(
    (filePath) =>
      fileContainsMarker(filePath) ||
      fileContainsMarker(`${filePath}.cutover.tmp`),
  );
  if (markerPath !== undefined) {
    fail(
      "cutover_supersede_too_late",
      `Kernel guard conversion already published a permanent marker at ${markerPath}.`,
    );
  }
}

export function planAutomationKernelGuardCutoverSupersede({
  plan: rawOldPlan,
  nowMs = Date.now(),
}) {
  const oldPlan = normalizePlan(rawOldPlan);
  requireLocalFilesystem(oldPlan.parameters.stateRoot, { plan: oldPlan });
  requireSupersedeStillPreMarker(oldPlan);
  if (existsSync(cutoverWriteAheadPath(oldPlan))) {
    requireSupersedeWriteAheadScope(readWriteAheadRecord(oldPlan));
  }
  const transactionRecord = exactTransactionRecord(oldPlan);
  if (
    transactionRecord === null ||
    !["prepared", "claims-installed"].includes(
      transactionRecord.transaction.phase,
    )
  ) {
    fail(
      "cutover_supersede_too_late",
      "Only a prepared or claims-installed cutover can be superseded.",
    );
  }
  const currentTask = currentCanonicalTask(oldPlan);
  const parameters = {
    schemaVersion: 1,
    policy: AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
    taskId: oldPlan.taskId,
    stateRoot: oldPlan.parameters.stateRoot,
    cutoverId: oldPlan.parameters.cutoverId,
    oldPlanDigest: sha256(canonicalJsonBytes(oldPlan)),
    transactionDigest: sha256(transactionRecord.bytes),
    transactionPhase: transactionRecord.transaction.phase,
    claimGenerationsDigest: sha256(
      canonicalJsonBytes(transactionRecord.transaction.claimGenerations),
    ),
    sourceSnapshotDigest: oldPlan.parameters.sourceSnapshotDigest,
    archiveManifestDigest: oldPlan.parameters.archiveManifestDigest,
    currentTaskDigest: sha256(canonicalJsonBytes(currentTask)),
  };
  parameters.supersedeId = supersedeIdFor(parameters);
  const intent = {
    schemaVersion: 1,
    action: CUTOVER_SUPERSEDE_ACTION,
    taskId: oldPlan.taskId,
    parameters,
  };
  const supersedePlan = normalizeSupersedePlan(
    {
      schemaVersion: 1,
      kind: CUTOVER_SUPERSEDE_PLAN_KIND,
      action: "automation-guard.cutover.supersede.plan",
      createdAt: new Date(nowMs).toISOString(),
      taskId: oldPlan.taskId,
      parameters,
      currentTask,
      intent,
      intentDigest: ownerGovernanceIntentDigest(intent),
    },
    oldPlan,
  );
  requireLocalFilesystem(oldPlan.parameters.stateRoot, {
    plan: oldPlan,
    supersedePlan,
    transaction: transactionRecord.transaction,
  });
  return supersedePlan;
}

function snapshotWithoutPaths(entry) {
  if (entry?.kind === "directory") {
    return {
      kind: entry.kind,
      mode: entry.mode,
      entries: entry.entries.map(snapshotWithoutPaths),
    };
  }
  if (entry?.kind === "file") {
    return {
      kind: entry.kind,
      mode: entry.mode,
      size: entry.size,
      digest: entry.digest,
      bytesBase64: entry.bytesBase64,
    };
  }
  return { kind: entry?.kind };
}

function snapshotIncludesBytes(entry) {
  if (entry?.kind === "file") return Object.hasOwn(entry, "bytesBase64");
  return Boolean(entry?.entries?.some(snapshotIncludesBytes));
}

function requireSnapshotMatch(expected, actualPath, label) {
  let actual;
  try {
    actual = snapshotPath(actualPath, {
      includeBytes: snapshotIncludesBytes(expected),
      maxBytes:
        expected?.kind === "file" && Number.isSafeInteger(expected.size)
          ? expected.size + 1
          : CUTOVER_MAX_FILE_BYTES,
    });
  } catch (error) {
    fail(
      "cutover_source_drift",
      `${label} cannot be revalidated: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    stableJson(snapshotWithoutPaths(actual)) !==
    stableJson(snapshotWithoutPaths(expected))
  ) {
    fail("cutover_source_drift", `${label} changed after planning.`);
  }
}

function sourceEntry(plan, targetPath) {
  const direct = plan.sourceSnapshot.entries.find(
    (entry) => entry.path === targetPath,
  );
  if (direct) return direct;
  const guardsRoot = automationKernelGuardCutoverPaths(
    plan.parameters.stateRoot,
  ).guardsRoot;
  const guardRootEntry = plan.sourceSnapshot.entries.find(
    (entry) => entry.path === guardsRoot,
  );
  return guardRootEntry?.entries?.find((entry) => entry.path === targetPath);
}

function validateUnmigratedSource(plan) {
  const current = snapshotCutoverSource({
    stateRoot: plan.parameters.stateRoot,
    codexHome: plan.parameters.codexHome,
    repoRoot: plan.parameters.repoRoot,
  });
  requireCanonicalTask(current.snapshot, plan.taskId);
  if (
    current.snapshotDigest !== plan.parameters.sourceSnapshotDigest ||
    current.archiveManifestDigest !== plan.parameters.archiveManifestDigest
  ) {
    fail(
      "cutover_source_drift",
      "Kernel guard cutover source changed after planning.",
    );
  }
}

function validateStaticSource(plan) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  for (const expected of plan.sourceSnapshot.entries) {
    if (
      expected.path === paths.writerLock ||
      expected.path === paths.guardsRoot
    ) {
      continue;
    }
    requireSnapshotMatch(
      expected,
      expected.path,
      `Cutover source ${expected.path}`,
    );
  }
  requireCanonicalTask(plan.sourceSnapshot, plan.taskId);
  requirePausedActors(plan.parameters.codexHome);
  const repo = exactDevIdentity(plan.parameters.repoRoot);
  if (repo.sourceCodeSha !== plan.parameters.sourceCodeSha) {
    fail("cutover_source_drift", "Exact dev identity changed after planning.");
  }
}

function requireNoLeases(stateRoot) {
  const leases = path.join(stateRoot, "control", "leases");
  if (!existsSync(leases)) return;
  requirePrivateDirectory(leases, "Automation lease root");
  if (readdirSync(leases).length !== 0) {
    fail(
      "cutover_lease_live",
      "Every canonical lease must be absent before cutover.",
    );
  }
}

function requireNoOldControlProcess() {
  const output = execFileSync("/bin/ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match || Number(match[1]) === process.pid) continue;
    if (
      CONTROL_PROCESS_PATTERNS.some((pattern) => match[2].includes(pattern))
    ) {
      fail(
        "cutover_process_live",
        `Older control-plane process ${Number(match[1]).toLocaleString()} is still running.`,
      );
    }
  }
}

function processIsLive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function legacyOwnerIsLive(owner) {
  if (
    owner?.schemaVersion !== 1 ||
    !Number.isSafeInteger(owner?.pid) ||
    owner.pid <= 0 ||
    !Object.hasOwn(owner, "processStartIdentity") ||
    !(
      owner.processStartIdentity === null ||
      typeof owner.processStartIdentity === "string"
    )
  ) {
    return false;
  }
  const identity = processStartIdentity(owner.pid);
  if (typeof owner.processStartIdentity === "string" && identity !== null) {
    return identity === owner.processStartIdentity;
  }
  return processIsLive(owner.pid);
}

function readLegacyOwner(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(
      fatalDecoder.decode(readBoundedRegularFile(filePath, 64 * 1024)),
    );
  } catch {
    return null;
  }
}

function lsofPath() {
  if (process.platform === "darwin") return "/usr/sbin/lsof";
  if (process.platform === "linux") return "/usr/bin/lsof";
  return "";
}

function requireNoOpenStateDescriptor(stateRoot) {
  const command = lsofPath();
  if (command === "" || !existsSync(command)) {
    fail(
      "cutover_lsof_missing",
      "Kernel guard cutover requires the platform lsof tool for quiescence proof.",
    );
  }
  try {
    const output = execFileSync(command, ["-F", "pn", "+D", stateRoot], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
    const pids = [...output.matchAll(/^p(\d+)$/gm)]
      .map((match) => Number(match[1]))
      .filter((pid) => pid !== process.pid);
    if (pids.length > 0) {
      fail(
        "cutover_descriptor_live",
        `Automation state still has open descriptors from process ${pids[0].toLocaleString()}.`,
      );
    }
  } catch (error) {
    if (error instanceof AutomationControlError) throw error;
    if (error?.status !== 1 || String(error?.stderr ?? "").trim() !== "") {
      throw error;
    }
  }
}

function requireQuiescence(plan) {
  requirePausedActors(plan.parameters.codexHome);
  requireNoLeases(plan.parameters.stateRoot);
  requireNoOldControlProcess();
  requireNoOpenStateDescriptor(plan.parameters.stateRoot);
}

function transactionPath(plan) {
  return automationKernelGuardCutoverPaths(plan.parameters.stateRoot)
    .transaction;
}

function readTransaction(
  plan,
  checkpoint = () => undefined,
  { allowIncompleteAuthorizationEvidence = false } = {},
) {
  const filePath = transactionPath(plan);
  if (!existsSync(filePath)) return null;
  let transaction;
  try {
    transaction = JSON.parse(
      fatalDecoder.decode(
        readPrivateMode600File(filePath, 1024 * 1024, new Set([1]), () =>
          checkpoint("transaction-private-file-opened", { filePath }),
        ),
      ),
    );
  } catch {
    fail(
      "cutover_transaction_invalid",
      "Kernel guard cutover transaction is malformed.",
    );
  }
  const planDigest = sha256(canonicalJsonBytes(plan));
  const expectedKeys = [
    "authorizations",
    "claimGenerations",
    "cutoverId",
    "kind",
    "phase",
    "planDigest",
    "preparedAt",
    "schemaVersion",
    ...(transaction?.phase === "receipt-prepared" ? ["completedAt"] : []),
  ].sort();
  const claimGenerationKeys = [
    "claimToken",
    "claimedAt",
    "pid",
    "processStartIdentity",
  ].sort();
  const preparedAtMs = Date.parse(String(transaction?.preparedAt ?? ""));
  const completedAtMs = Date.parse(String(transaction?.completedAt ?? ""));
  const authorizationIdentities = Array.isArray(transaction?.authorizations)
    ? transaction.authorizations.map(
        (authorization) =>
          `${authorization?.confirmationId ?? ""}:${authorization?.confirmationDigest ?? ""}:${authorization?.validatedAt ?? ""}`,
      )
    : [];
  const finalAuthorization = Array.isArray(transaction?.authorizations)
    ? transaction.authorizations.at(-1)
    : undefined;
  const finalAuthorizationValidatedAtMs = Date.parse(
    String(finalAuthorization?.validatedAt ?? ""),
  );
  const finalAuthorizationExpiresAtMs =
    finalAuthorization === undefined
      ? Number.NaN
      : storedConfirmationExpiryMs(finalAuthorization);
  const claimTokens = Array.isArray(transaction?.claimGenerations)
    ? transaction.claimGenerations.map((generation) => generation?.claimToken)
    : [];
  if (
    transaction?.schemaVersion !== 1 ||
    transaction?.kind !== CUTOVER_TRANSACTION_KIND ||
    transaction?.cutoverId !== plan.parameters.cutoverId ||
    transaction?.planDigest !== planDigest ||
    ![
      "prepared",
      "claims-installed",
      "markers-installed",
      "receipt-prepared",
    ].includes(transaction?.phase) ||
    Object.keys(transaction).sort().join("\n") !== expectedKeys.join("\n") ||
    !isCanonicalTimestamp(transaction.preparedAt) ||
    Date.parse(plan.createdAt) > preparedAtMs ||
    (transaction.phase === "receipt-prepared" &&
      (!isCanonicalTimestamp(transaction.completedAt) ||
        completedAtMs < preparedAtMs ||
        !Number.isFinite(finalAuthorizationValidatedAtMs) ||
        !Number.isFinite(finalAuthorizationExpiresAtMs) ||
        completedAtMs !== finalAuthorizationValidatedAtMs ||
        completedAtMs >= finalAuthorizationExpiresAtMs)) ||
    !Array.isArray(transaction.authorizations) ||
    transaction.authorizations.length === 0 ||
    transaction.authorizations.length > CUTOVER_MAX_AUTHORIZATIONS ||
    new Set(authorizationIdentities).size !== authorizationIdentities.length ||
    !Array.isArray(transaction.claimGenerations) ||
    transaction.claimGenerations.length > CUTOVER_MAX_CLAIM_GENERATIONS ||
    new Set(claimTokens).size !== claimTokens.length ||
    transaction.claimGenerations.some(
      (generation) =>
        generation === null ||
        typeof generation !== "object" ||
        Array.isArray(generation) ||
        Object.keys(generation).sort().join("\n") !==
          claimGenerationKeys.join("\n") ||
        !SHA256_PATTERN.test(String(generation.claimToken ?? "")) ||
        !Number.isSafeInteger(generation.pid) ||
        generation.pid <= 0 ||
        typeof generation.processStartIdentity !== "string" ||
        generation.processStartIdentity.length === 0 ||
        !isCanonicalTimestamp(generation.claimedAt) ||
        Date.parse(generation.claimedAt) < preparedAtMs ||
        (transaction.phase === "receipt-prepared" &&
          Date.parse(generation.claimedAt) > completedAtMs),
    ) ||
    transaction.authorizations.some(
      (authorization, index) =>
        !authorizationRecordIsValid(plan, authorization) ||
        Date.parse(authorization.validatedAt) < preparedAtMs ||
        (index > 0 &&
          Date.parse(authorization.validatedAt) <=
            Date.parse(transaction.authorizations[index - 1].validatedAt)) ||
        (transaction.phase === "receipt-prepared" &&
          Date.parse(authorization.validatedAt) > completedAtMs),
    )
  ) {
    fail(
      "cutover_transaction_invalid",
      "Kernel guard cutover transaction conflicts.",
    );
  }
  for (const authorization of transaction.authorizations) {
    const evidenceTemporaryPath = `${authorization.confirmationArtifact}.cutover.tmp`;
    if (
      allowIncompleteAuthorizationEvidence &&
      !existsSync(authorization.confirmationArtifact) &&
      !existsSync(evidenceTemporaryPath)
    ) {
      continue;
    }
    if (allowIncompleteAuthorizationEvidence) {
      requireImmutableTargetPreflight(
        authorization.confirmationArtifact,
        Buffer.from(authorization.confirmationBytesBase64, "base64"),
      );
      continue;
    }
    const evidence = readPrivateMode600File(
      authorization.confirmationArtifact,
      64 * 1024,
    );
    if (
      sha256(evidence) !== authorization.confirmationRawDigest ||
      evidence.toString("base64") !== authorization.confirmationBytesBase64
    ) {
      fail(
        "cutover_transaction_invalid",
        "Kernel guard cutover authorization evidence conflicts.",
      );
    }
  }
  const preparedAuthorizationPath = preparedAuthorizationArtifactPath(plan);
  const preparedAuthorizationTemporaryPath = `${preparedAuthorizationPath}.cutover.tmp`;
  if (
    allowIncompleteAuthorizationEvidence &&
    !existsSync(preparedAuthorizationPath) &&
    !existsSync(preparedAuthorizationTemporaryPath)
  ) {
    return transaction;
  }
  if (allowIncompleteAuthorizationEvidence) {
    requireImmutableTargetPreflight(
      preparedAuthorizationPath,
      prettyJsonBytes(transaction.authorizations[0]),
    );
    return transaction;
  }
  const preparedAuthorization = readPrivateMode600File(
    preparedAuthorizationPath,
    128 * 1024,
  );
  if (
    !preparedAuthorization.equals(
      prettyJsonBytes(transaction.authorizations[0]),
    )
  ) {
    fail(
      "cutover_transaction_invalid",
      "Kernel guard cutover first authorization evidence conflicts.",
    );
  }
  return transaction;
}

function authorizationArtifactPath(plan, authorization) {
  return path.join(
    artifactDirectory(plan),
    "authorizations",
    `${authorization.confirmationDigest}-${authorization.confirmationRawDigest}.json`,
  );
}

function preparedAuthorizationArtifactPath(plan) {
  return path.join(
    artifactDirectory(plan),
    "authorizations",
    "prepared-authorization.json",
  );
}

function authorizationRecordIsValid(plan, authorization) {
  return (
    authorization !== null &&
    typeof authorization === "object" &&
    !Array.isArray(authorization) &&
    Object.keys(authorization).sort().join("\n") ===
      CUTOVER_AUTHORIZATION_KEYS.join("\n") &&
    authorization.actor === "freed-owner" &&
    IDENTIFIER_PATTERN.test(String(authorization.confirmationId ?? "")) &&
    SHA256_PATTERN.test(String(authorization.confirmationDigest ?? "")) &&
    SHA256_PATTERN.test(String(authorization.confirmationRawDigest ?? "")) &&
    authorization.intentDigest === plan.intentDigest &&
    storedConfirmationEvidenceIsValid(plan, authorization) &&
    isCanonicalTimestamp(authorization.validatedAt)
  );
}

function storedConfirmationEvidenceIsValid(plan, authorization) {
  let bytes;
  let confirmation;
  let confirmationDigest;
  let embeddedIntentDigest;
  try {
    bytes = Buffer.from(authorization.confirmationBytesBase64, "base64");
    if (
      bytes.toString("base64") !== authorization.confirmationBytesBase64 ||
      sha256(bytes) !== authorization.confirmationRawDigest
    ) {
      return false;
    }
    confirmation = JSON.parse(fatalDecoder.decode(bytes));
    confirmationDigest = ownerGovernanceIntentDigest(confirmation);
    embeddedIntentDigest = ownerGovernanceIntentDigest(confirmation?.intent);
  } catch {
    return false;
  }
  const requiredKeys = [
    "approvalSource",
    "approvedAt",
    "approvedBy",
    "confirmationId",
    "expiresAt",
    "intent",
    "intentDigest",
    "kind",
    "ownerApprovalReference",
    "schemaVersion",
    "taskId",
  ].sort();
  const source = confirmation?.approvalSource;
  const approvedAtMs = Date.parse(String(confirmation?.approvedAt ?? ""));
  const expiresAtMs = Date.parse(String(confirmation?.expiresAt ?? ""));
  const validatedAtMs = Date.parse(String(authorization?.validatedAt ?? ""));
  return (
    confirmation?.schemaVersion === 1 &&
    confirmation?.kind === "owner-confirmation" &&
    Object.keys(confirmation).sort().join("\n") === requiredKeys.join("\n") &&
    confirmation.confirmationId === authorization.confirmationId &&
    confirmation.approvedBy === "AubreyF" &&
    typeof confirmation.ownerApprovalReference === "string" &&
    confirmation.ownerApprovalReference.trim() !== "" &&
    source !== null &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    Object.keys(source).sort().join("\n") === "kind\nreference" &&
    source.kind === "current-task" &&
    typeof source.reference === "string" &&
    source.reference.trim() !== "" &&
    confirmation.taskId === plan.taskId &&
    confirmation.intent?.taskId === plan.taskId &&
    confirmation.intent?.action === CUTOVER_ACTION &&
    confirmation.intentDigest === plan.intentDigest &&
    embeddedIntentDigest === plan.intentDigest &&
    confirmationDigest === authorization.confirmationDigest &&
    isCanonicalTimestamp(confirmation.approvedAt) &&
    isCanonicalTimestamp(confirmation.expiresAt) &&
    expiresAtMs > approvedAtMs &&
    Number.isFinite(validatedAtMs) &&
    validatedAtMs >= approvedAtMs &&
    validatedAtMs < expiresAtMs &&
    path.isAbsolute(authorization.confirmationPath) &&
    path.resolve(authorization.confirmationPath) ===
      authorization.confirmationPath &&
    authorization.confirmationArtifact ===
      authorizationArtifactPath(plan, authorization)
  );
}

function storedConfirmationExpiryMs(authorization) {
  try {
    const bytes = Buffer.from(authorization.confirmationBytesBase64, "base64");
    const confirmation = JSON.parse(fatalDecoder.decode(bytes));
    return Date.parse(String(confirmation.expiresAt ?? ""));
  } catch {
    return Number.NaN;
  }
}

function writeAuthorizationEvidence(
  plan,
  authorization,
  beforeMutation = () => undefined,
  checkpoint = () => undefined,
  linkedCheckpointName = "",
) {
  if (!storedConfirmationEvidenceIsValid(plan, authorization)) {
    fail(
      "cutover_authorization_invalid",
      "Cutover authorization evidence conflicts.",
    );
  }
  writeImmutable(
    authorization.confirmationArtifact,
    Buffer.from(authorization.confirmationBytesBase64, "base64"),
    { beforeMutation, checkpoint, linkedCheckpointName },
  );
}

function writePreparedAuthorizationEvidence(
  plan,
  authorization,
  beforeMutation = () => undefined,
  checkpoint = () => undefined,
  linkedCheckpointName = "",
) {
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    extraPaths: [preparedAuthorizationArtifactPath(plan)],
  });
  writeImmutable(
    preparedAuthorizationArtifactPath(plan),
    prettyJsonBytes(authorization),
    { beforeMutation, checkpoint, linkedCheckpointName },
  );
}

function readCanonicalAuthorizationRecord(plan, filePath, label) {
  let bytes;
  let record;
  try {
    bytes = readPrivateMode600File(filePath, 128 * 1024);
    record = JSON.parse(fatalDecoder.decode(bytes));
  } catch {
    fail(
      "cutover_authorization_invalid",
      `${label} is malformed or unsafe.`,
    );
  }
  if (
    !authorizationRecordIsValid(plan, record) ||
    !bytes.equals(prettyJsonBytes(record))
  ) {
    fail("cutover_authorization_invalid", `${label} conflicts.`);
  }
  return record;
}

function recoverPreparedAuthorizationRecord(
  plan,
  checkpoint,
  beforeMutation = () => undefined,
) {
  const filePath = preparedAuthorizationArtifactPath(plan);
  const temporaryPath = `${filePath}.cutover.tmp`;
  const readablePath = existsSync(filePath) ? filePath : temporaryPath;
  let bytes;
  let record;
  try {
    bytes = readPrivateMode600File(
      readablePath,
      128 * 1024,
      new Set([1, 2]),
    );
    record = JSON.parse(fatalDecoder.decode(bytes));
  } catch {
    fail(
      "cutover_authorization_invalid",
      "Kernel guard cutover prepared authorization record is malformed or unsafe.",
    );
  }
  if (
    !authorizationRecordIsValid(plan, record) ||
    !bytes.equals(prettyJsonBytes(record))
  ) {
    fail(
      "cutover_authorization_invalid",
      "Kernel guard cutover prepared authorization record conflicts.",
    );
  }
  requireImmutableTargetPreflight(filePath, bytes);
  writeImmutable(filePath, bytes, {
    beforeMutation,
    checkpoint,
    linkedCheckpointName: "prepared-authorization-recovery-linked",
  });
  return record;
}

function transactionAuthorizationRecord(
  plan,
  authorization,
  minimumValidatedAtMs = undefined,
) {
  const confirmationBytes = readPrivateMode600File(
    authorization.confirmationFile,
    64 * 1024,
  );
  let parsed;
  try {
    parsed = JSON.parse(fatalDecoder.decode(confirmationBytes));
  } catch {
    fail(
      "cutover_authorization_invalid",
      "Validated owner confirmation bytes changed.",
    );
  }
  if (
    ownerGovernanceIntentDigest(parsed) !== authorization.digest ||
    parsed.confirmationId !== authorization.confirmation.confirmationId ||
    parsed.taskId !== plan.taskId ||
    parsed.intentDigest !== plan.intentDigest
  ) {
    fail(
      "cutover_authorization_invalid",
      "Validated owner confirmation bytes changed.",
    );
  }
  const validatedAtMs = Math.max(
    Date.now(),
    Number.isFinite(minimumValidatedAtMs)
      ? minimumValidatedAtMs + 1
      : Number.NEGATIVE_INFINITY,
  );
  const expiresAtMs = Date.parse(String(parsed.expiresAt ?? ""));
  if (!Number.isFinite(expiresAtMs) || validatedAtMs >= expiresAtMs) {
    fail(
      "cutover_authorization_invalid",
      "Owner confirmation expired before its durable authorization record.",
    );
  }
  const record = {
    actor: "freed-owner",
    confirmationId: authorization.confirmation.confirmationId,
    confirmationDigest: authorization.digest,
    confirmationPath: authorization.confirmationFile,
    confirmationBytesBase64: confirmationBytes.toString("base64"),
    confirmationRawDigest: sha256(confirmationBytes),
    confirmationArtifact: "",
    intentDigest: authorization.confirmation.intentDigest,
    validatedAt: new Date(validatedAtMs).toISOString(),
  };
  record.confirmationArtifact = authorizationArtifactPath(plan, record);
  return record;
}

function sameTransactionAuthorizationSource(left, right) {
  return (
    left.actor === right.actor &&
    left.confirmationId === right.confirmationId &&
    left.confirmationDigest === right.confirmationDigest &&
    left.confirmationPath === right.confirmationPath &&
    left.confirmationBytesBase64 === right.confirmationBytesBase64 &&
    left.confirmationRawDigest === right.confirmationRawDigest &&
    left.confirmationArtifact === right.confirmationArtifact &&
    left.intentDigest === right.intentDigest
  );
}

function transactionAuthorizationFilesystemPaths(record) {
  return [
    record.confirmationArtifact,
    `${record.confirmationArtifact}.cutover.tmp`,
  ];
}

function recoverPreparedAuthorizationTransaction(
  plan,
  checkpoint,
  beforeMutation = () => undefined,
) {
  const preparedPath = preparedAuthorizationArtifactPath(plan);
  if (!existsSync(preparedPath)) return null;
  const authorization = recoverPreparedAuthorizationRecord(
    plan,
    checkpoint,
    beforeMutation,
  );
  if (Date.parse(authorization.validatedAt) < Date.parse(plan.createdAt)) {
    fail(
      "cutover_authorization_invalid",
      "Kernel guard cutover prepared authorization predates its plan.",
    );
  }
  writeAuthorizationEvidence(
    plan,
    authorization,
    beforeMutation,
    checkpoint,
    "prepared-authorization-recovery-evidence-linked",
  );
  const transaction = {
    schemaVersion: 1,
    kind: CUTOVER_TRANSACTION_KIND,
    cutoverId: plan.parameters.cutoverId,
    planDigest: sha256(canonicalJsonBytes(plan)),
    phase: "prepared",
    preparedAt: authorization.validatedAt,
    authorizations: [authorization],
    claimGenerations: [],
  };
  writeTransaction(plan, transaction, beforeMutation);
  checkpoint("transaction-prepared-recovered", {
    cutoverId: plan.parameters.cutoverId,
  });
  return transaction;
}

function repairTransactionAuthorizationEvidence(
  plan,
  transaction,
  checkpoint,
  beforeMutation = () => undefined,
) {
  for (const authorization of transaction.authorizations) {
    const recoveryNeeded =
      !existsSync(authorization.confirmationArtifact) ||
      existsSync(`${authorization.confirmationArtifact}.cutover.tmp`);
    writeAuthorizationEvidence(
      plan,
      authorization,
      beforeMutation,
      checkpoint,
      "transaction-authorization-evidence-recovery-linked",
    );
    if (recoveryNeeded) {
      checkpoint("transaction-authorization-evidence-recovered", {
        confirmationId: authorization.confirmationId,
        filePath: authorization.confirmationArtifact,
      });
    }
  }
  const preparedPath = preparedAuthorizationArtifactPath(plan);
  const preparedRecoveryNeeded =
    !existsSync(preparedPath) || existsSync(`${preparedPath}.cutover.tmp`);
  writePreparedAuthorizationEvidence(
    plan,
    transaction.authorizations[0],
    beforeMutation,
    checkpoint,
    "prepared-authorization-evidence-recovery-linked",
  );
  if (preparedRecoveryNeeded) {
    checkpoint("prepared-authorization-evidence-recovered", {
      confirmationId: transaction.authorizations[0].confirmationId,
      filePath: preparedPath,
    });
  }
  return readTransaction(plan);
}

function recordTransactionAuthorization(
  plan,
  transaction,
  authorization,
  expectedSource = undefined,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  if (transaction.phase === "receipt-prepared") {
    fail(
      "cutover_authorization_conflict",
      "Cutover receipt preparation already binds its final owner confirmation.",
    );
  }
  if (transaction.authorizations.length >= CUTOVER_MAX_AUTHORIZATIONS) {
    fail(
      "cutover_authorization_exhausted",
      "Kernel guard cutover exceeded its bounded retry authorizations.",
    );
  }
  const nextAuthorization = transactionAuthorizationRecord(
    plan,
    authorization,
    Date.parse(transaction.authorizations.at(-1).validatedAt),
  );
  if (
    expectedSource !== undefined &&
    !sameTransactionAuthorizationSource(nextAuthorization, expectedSource)
  ) {
    fail(
      "cutover_authorization_invalid",
      "Validated owner confirmation changed after filesystem admission.",
    );
  }
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    transaction,
    extraPaths: transactionAuthorizationFilesystemPaths(nextAuthorization),
  });
  const updated = {
    ...transaction,
    authorizations: [...transaction.authorizations, nextAuthorization],
    ...(transaction.phase === "receipt-prepared"
      ? { completedAt: nextAuthorization.validatedAt }
      : {}),
  };
  writeTransaction(plan, updated, beforeMutation);
  checkpoint("retry-authorization-transaction-durable", {
    confirmationId: nextAuthorization.confirmationId,
  });
  writeAuthorizationEvidence(
    plan,
    nextAuthorization,
    beforeMutation,
    checkpoint,
    "retry-authorization-evidence-linked",
  );
  checkpoint("retry-authorization-evidence-durable", {
    confirmationId: nextAuthorization.confirmationId,
    filePath: nextAuthorization.confirmationArtifact,
  });
  return updated;
}

function currentClaimGeneration(
  plan,
  transaction,
  beforeMutation = () => undefined,
) {
  const identity = processStartIdentity(process.pid);
  if (typeof identity !== "string" || identity.length === 0) {
    fail(
      "cutover_claim_unavailable",
      "Kernel guard cutover cannot bind the current process identity.",
    );
  }
  const current = transaction.claimGenerations.at(-1);
  if (
    current?.pid === process.pid &&
    current.processStartIdentity === identity
  ) {
    return { transaction, generation: current };
  }
  if (transaction.claimGenerations.length >= CUTOVER_MAX_CLAIM_GENERATIONS) {
    fail(
      "cutover_claim_exhausted",
      "Kernel guard cutover exceeded its bounded claim recovery generations.",
    );
  }
  const generation = {
    claimToken: randomBytes(32).toString("hex"),
    claimedAt: new Date().toISOString(),
    pid: process.pid,
    processStartIdentity: identity,
  };
  const updated = {
    ...transaction,
    claimGenerations: [...transaction.claimGenerations, generation],
  };
  writeTransaction(plan, updated, beforeMutation);
  return { transaction: updated, generation };
}

function cutoverClaimRecord(plan, generation, target) {
  return {
    schemaVersion: 1,
    owner: `kernel-cutover:${plan.parameters.cutoverId}:${target}:${generation.claimToken}`,
    token: generation.claimToken,
    pid: generation.pid,
    processStartIdentity: generation.processStartIdentity,
    acquiredAt: generation.claimedAt,
    lockProtocol: CUTOVER_CLAIM_PROTOCOL,
    cutoverId: plan.parameters.cutoverId,
    planDigest: sha256(canonicalJsonBytes(plan)),
    claimToken: generation.claimToken,
    target,
  };
}

function cutoverClaimBytes(plan, generation, target) {
  return prettyJsonBytes(cutoverClaimRecord(plan, generation, target));
}

function writeTransaction(
  plan,
  transaction,
  beforeMutation = () => undefined,
) {
  writeAtomic(
    transactionPath(plan),
    prettyJsonBytes(transaction),
    beforeMutation,
  );
}

function artifactDirectory(plan) {
  return path.join(
    automationKernelGuardCutoverPaths(plan.parameters.stateRoot).artifactRoot,
    plan.parameters.cutoverId,
  );
}

function legacyManifest(plan) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  return {
    schemaVersion: 1,
    entries: plan.sourceSnapshot.entries.filter(
      (entry) =>
        entry.path === paths.writerLock || entry.path === paths.guardsRoot,
    ),
  };
}

function exactMarkerFile(filePath) {
  if (!existsSync(filePath)) return false;
  try {
    const stats = lstatSync(filePath);
    return (
      stats.isFile() &&
      !stats.isSymbolicLink() &&
      stats.uid === currentUid(stats) &&
      (stats.mode & 0o7777) === 0o600 &&
      stats.nlink === 1 &&
      realpathSync(filePath) === path.resolve(filePath) &&
      readPrivateMode600File(
        filePath,
        automationKernelGuardMarkerBytes().length,
      ).equals(automationKernelGuardMarkerBytes())
    );
  } catch {
    return false;
  }
}

function exactPrivateFileBytes(
  filePath,
  expectedBytes,
  allowedLinkCounts = new Set([1]),
) {
  if (!existsSync(filePath)) return false;
  try {
    return readPrivateMode600File(
      filePath,
      expectedBytes.length,
      allowedLinkCounts,
    ).equals(expectedBytes);
  } catch {
    return false;
  }
}

function exactClaimFile(filePath, plan, generation, target) {
  return exactPrivateFileBytes(
    filePath,
    cutoverClaimBytes(plan, generation, target),
  );
}

function claimGenerationForFile(filePath, plan, transaction, target) {
  return transaction.claimGenerations.findLast((generation) =>
    exactClaimFile(filePath, plan, generation, target),
  );
}

function exactMarkerDirectory(guard) {
  if (!existsSync(guard.directory)) return false;
  try {
    requirePrivateDirectory(guard.directory, guard.directory);
    const names = readdirSync(guard.directory).sort();
    return (
      names.join("\n") === "kernel.lock\nowner.json" &&
      exactMarkerFile(guard.owner) &&
      exactMarkerFile(guard.inner)
    );
  } catch {
    return false;
  }
}

function prepareMarkerTemporaryFile(
  temporaryPath,
  beforeMutation = () => undefined,
) {
  const bytes = automationKernelGuardMarkerBytes();
  if (existsSync(temporaryPath)) {
    let reusable = false;
    try {
      reusable = readPrivateMode600File(temporaryPath, bytes.length).equals(
        bytes,
      );
    } catch {
      reusable = false;
    }
    if (reusable) return;
    fail(
      "cutover_conflict",
      `Cutover marker temporary path conflicts: ${temporaryPath}`,
    );
  }
  let descriptor;
  try {
    beforeMutation();
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function recoverNoReplaceLink(
  filePath,
  temporaryPath,
  bytes,
  beforeMutation = () => undefined,
) {
  if (!existsSync(filePath) || !existsSync(temporaryPath)) return false;
  const current = lstatSync(filePath);
  const temporary = lstatSync(temporaryPath);
  if (
    !current.isFile() ||
    !temporary.isFile() ||
    current.dev !== temporary.dev ||
    current.ino !== temporary.ino ||
    current.nlink !== 2 ||
    temporary.nlink !== 2 ||
    !exactPrivateFileBytes(filePath, bytes, new Set([2]))
  ) {
    return false;
  }
  beforeMutation();
  unlinkSync(temporaryPath);
  syncDirectory(path.dirname(filePath));
  return true;
}

function recoverAnyClaimLink(
  filePath,
  plan,
  transaction,
  target,
  beforeMutation = () => undefined,
) {
  const temporaryPath = `${filePath}.cutover-claim.tmp`;
  if (!existsSync(temporaryPath)) return;
  for (const generation of transaction.claimGenerations) {
    if (
      recoverNoReplaceLink(
        filePath,
        temporaryPath,
        cutoverClaimBytes(plan, generation, target),
        beforeMutation,
      )
    ) {
      return;
    }
  }
}

function recoverPermanentMarkerLink(
  filePath,
  beforeMutation = () => undefined,
  checkpoint = () => undefined,
  checkpointName = "permanent-marker-linked",
) {
  const temporaryPath = `${filePath}.cutover.tmp`;
  if (existsSync(filePath) && existsSync(temporaryPath)) {
    checkpoint(`${checkpointName}-recovery-before-unlink`, {
      filePath,
      temporaryPath,
    });
  }
  recoverNoReplaceLink(
    filePath,
    temporaryPath,
    automationKernelGuardMarkerBytes(),
    beforeMutation,
  );
}

function installNoReplaceExactBytes(
  filePath,
  bytes,
  {
    checkpoint = () => undefined,
    checkpointName,
    temporarySuffix,
    beforeMutation = () => undefined,
  },
) {
  const temporaryPath = `${filePath}.${temporarySuffix}.tmp`;
  recoverNoReplaceLink(filePath, temporaryPath, bytes, beforeMutation);
  if (exactPrivateFileBytes(filePath, bytes)) {
    if (existsSync(temporaryPath)) {
      fail(
        "cutover_conflict",
        `Cutover claim temporary path conflicts: ${temporaryPath}`,
      );
    }
    syncDirectory(path.dirname(filePath));
    return;
  }
  if (existsSync(filePath)) {
    fail("cutover_conflict", `Cutover claim path is occupied: ${filePath}`);
  }
  if (existsSync(temporaryPath)) {
    if (!exactPrivateFileBytes(temporaryPath, bytes)) {
      fail(
        "cutover_conflict",
        `Cutover claim temporary path conflicts: ${temporaryPath}`,
      );
    }
  }
  if (!existsSync(temporaryPath)) {
    let descriptor;
    try {
      beforeMutation();
      descriptor = openSync(temporaryPath, "wx", 0o600);
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
  try {
    beforeMutation();
    linkSync(temporaryPath, filePath);
  } catch (error) {
    if (error?.code !== "EEXIST" || !exactPrivateFileBytes(filePath, bytes)) {
      throw error;
    }
  }
  const current = lstatSync(filePath);
  const temporary = lstatSync(temporaryPath);
  if (current.dev !== temporary.dev || current.ino !== temporary.ino) {
    fail("cutover_conflict", `Cutover claim identity conflicts: ${filePath}`);
  }
  checkpoint(checkpointName, { filePath, temporaryPath });
  beforeMutation();
  unlinkSync(temporaryPath);
  syncDirectory(path.dirname(filePath));
  if (!exactPrivateFileBytes(filePath, bytes)) {
    fail("cutover_conflict", `Cutover claim did not verify: ${filePath}`);
  }
}

function possiblePrefixRewriteState(currentBytes, sourceBytes, targetBytes) {
  if (currentBytes.equals(sourceBytes) || currentBytes.equals(targetBytes)) {
    return true;
  }
  for (let offset = 1; offset <= targetBytes.length; offset += 1) {
    const expectedLength = Math.max(sourceBytes.length, offset);
    if (currentBytes.length !== expectedLength) continue;
    if (
      !currentBytes.subarray(0, offset).equals(targetBytes.subarray(0, offset))
    ) {
      continue;
    }
    if (
      offset >= sourceBytes.length ||
      currentBytes.subarray(offset).equals(sourceBytes.subarray(offset))
    ) {
      return true;
    }
  }
  return false;
}

function preparedRewriteRecord(
  plan,
  filePath,
  currentByteOptions,
  targetBytes,
  {
    operationName,
    supersedePlan = undefined,
    allowedModes,
    targetMode,
    checkpoint,
    checkpointName,
    beforeMutation = () => undefined,
  },
) {
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    supersedePlan,
    extraPaths: [filePath],
  });
  const existing = readWriteAheadRecord(plan, supersedePlan);
  const scope = writeAheadScope(plan, supersedePlan);
  if (existing !== null) {
    if (
      existing.operation !== "rewrite" ||
      existing.operationName !== operationName ||
      existing.filePath !== filePath ||
      existing.targetMode !== targetMode ||
      existing.targetDigest !== sha256(targetBytes) ||
      !currentByteOptions.some(
        (option) =>
          sha256(option) === existing.sourceDigest &&
          option.length === existing.sourceSize,
      )
    ) {
      fail(
        "cutover_write_ahead_conflict",
        "A different cutover rewrite is already pending.",
      );
    }
    return existing;
  }
  const before = lstatSync(filePath);
  const maxBytes = Math.max(
    targetBytes.length,
    ...currentByteOptions.map((option) => option.length),
  );
  const currentBytes = readBoundedRegularFile(
    filePath,
    maxBytes,
    new Set([1]),
    allowedModes,
  );
  const after = lstatSync(filePath);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.uid !== currentUid(before) ||
    !allowedModes.has(before.mode & 0o7777)
  ) {
    fail(
      "cutover_source_drift",
      `Legacy claim generation changed at ${filePath}.`,
    );
  }
  const sourceBytes = currentByteOptions.find((option) =>
    currentBytes.equals(option),
  );
  if (sourceBytes === undefined) {
    fail("cutover_source_drift", `Legacy claim source changed at ${filePath}.`);
  }
  const preparedAt = new Date().toISOString();
  const record = {
    schemaVersion: 1,
    kind: CUTOVER_WRITE_AHEAD_KIND,
    operation: "rewrite",
    scope: scope.scope,
    scopeId: scope.scopeId,
    cutoverId: plan.parameters.cutoverId,
    operationName,
    filePath,
    quarantinePath: null,
    sourceDev: String(before.dev),
    sourceIno: String(before.ino),
    sourceMode: before.mode & 0o7777,
    targetMode,
    sourceSize: sourceBytes.length,
    sourceDigest: sha256(sourceBytes),
    sourceBytesBase64: sourceBytes.toString("base64"),
    targetSize: targetBytes.length,
    targetDigest: sha256(targetBytes),
    targetBytesBase64: targetBytes.toString("base64"),
    sourceSnapshot: null,
    phase: "prepared",
    preparedAt,
    writtenAt: null,
  };
  record.operationId = writeAheadOperationId(record);
  checkpoint(`${checkpointName}-before-journal`, {
    filePath,
    operationId: record.operationId,
  });
  writeWriteAheadRecord(plan, record, supersedePlan, beforeMutation);
  checkpoint(`${checkpointName}-journal-durable`, {
    filePath,
    operationId: record.operationId,
  });
  return record;
}

function completePreparedRewrite(
  plan,
  record,
  {
    supersedePlan = undefined,
    checkpoint = () => undefined,
    checkpointName = "rewrite",
    beforeMutation = () => undefined,
  } = {},
) {
  const sourceBytes = Buffer.from(record.sourceBytesBase64, "base64");
  const targetBytes = Buffer.from(record.targetBytesBase64, "base64");
  let descriptor;
  try {
    const before = lstatSync(record.filePath);
    descriptor = openSync(
      record.filePath,
      constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const opened = fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      String(opened.dev) !== record.sourceDev ||
      String(opened.ino) !== record.sourceIno ||
      opened.uid !== currentUid(opened) ||
      opened.nlink !== 1 ||
      !new Set([record.sourceMode, record.targetMode]).has(
        opened.mode & 0o7777,
      ) ||
      realpathSync(record.filePath) !== path.resolve(record.filePath)
    ) {
      fail(
        "cutover_source_drift",
        `Legacy claim source changed at ${record.filePath}.`,
      );
    }
    const currentBytes = readOpenedBytes(descriptor, opened);
    if (!possiblePrefixRewriteState(currentBytes, sourceBytes, targetBytes)) {
      fail(
        "cutover_source_drift",
        `Legacy claim source changed at ${record.filePath}.`,
      );
    }
    const immediatelyBeforeWrite = lstatSync(record.filePath);
    if (
      immediatelyBeforeWrite.dev !== opened.dev ||
      immediatelyBeforeWrite.ino !== opened.ino
    ) {
      fail(
        "cutover_source_drift",
        `Legacy claim generation changed at ${record.filePath}.`,
      );
    }
    checkpoint(checkpointName, { filePath: record.filePath });
    beforeMutation();
    if (!currentBytes.equals(targetBytes)) {
      const firstBoundary = Math.max(1, Math.floor(targetBytes.length / 2));
      let offset = 0;
      while (offset < targetBytes.length) {
        const requested =
          offset === 0
            ? Math.min(firstBoundary, targetBytes.length)
            : targetBytes.length - offset;
        const count = writeSync(
          descriptor,
          targetBytes,
          offset,
          requested,
          offset,
        );
        if (count <= 0) {
          fail(
            "cutover_conflict",
            `Cutover claim write was incomplete: ${record.filePath}`,
          );
        }
        offset += count;
        if (offset === count) {
          checkpoint(`${checkpointName}-after-first-write`, {
            filePath: record.filePath,
            operationId: record.operationId,
          });
          beforeMutation();
        }
      }
      ftruncateSync(descriptor, targetBytes.length);
      checkpoint(`${checkpointName}-after-truncate`, {
        filePath: record.filePath,
        operationId: record.operationId,
      });
      beforeMutation();
      fchmodSync(descriptor, record.targetMode);
      checkpoint(`${checkpointName}-before-fsync`, {
        filePath: record.filePath,
        operationId: record.operationId,
      });
      beforeMutation();
      fsyncSync(descriptor);
      checkpoint(`${checkpointName}-after-fsync`, {
        filePath: record.filePath,
        operationId: record.operationId,
      });
    }
    const afterOpened = fstatSync(descriptor);
    const after = lstatSync(record.filePath);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      afterOpened.dev !== opened.dev ||
      afterOpened.ino !== opened.ino ||
      afterOpened.nlink !== 1 ||
      (afterOpened.mode & 0o7777) !== record.targetMode ||
      !readOpenedBytes(descriptor, afterOpened).equals(targetBytes)
    ) {
      fail(
        "cutover_source_drift",
        `Legacy claim generation changed at ${record.filePath}.`,
      );
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  syncDirectory(path.dirname(record.filePath));
  const finalStats = lstatSync(record.filePath);
  if (
    (finalStats.mode & 0o7777) !== record.targetMode ||
    String(finalStats.dev) !== record.sourceDev ||
    String(finalStats.ino) !== record.sourceIno ||
    !readBoundedRegularFile(
      record.filePath,
      targetBytes.length,
      new Set([1]),
      new Set([record.targetMode]),
    ).equals(targetBytes)
  ) {
    fail(
      "cutover_conflict",
      `Cutover claim did not verify: ${record.filePath}`,
    );
  }
  const written =
    record.phase === "written"
      ? record
      : { ...record, phase: "written", writtenAt: new Date().toISOString() };
  writeWriteAheadRecord(plan, written, supersedePlan, beforeMutation);
  checkpoint(`${checkpointName}-journal-written`, {
    filePath: record.filePath,
    operationId: record.operationId,
  });
  clearWriteAheadRecord(
    plan,
    checkpoint,
    `${checkpointName}-journal-unlinked`,
    { filePath: record.filePath, operationId: record.operationId },
    beforeMutation,
  );
}

function rewritePrivateFileInPlace(
  plan,
  filePath,
  currentByteOptions,
  targetBytes,
  {
    checkpoint = () => undefined,
    checkpointName,
    operationName,
    supersedePlan = undefined,
    allowedModes = new Set([0o600, 0o640, 0o644]),
    targetMode = 0o600,
    beforeMutation = () => undefined,
  },
) {
  beforeMutation();
  const record = preparedRewriteRecord(
    plan,
    filePath,
    currentByteOptions,
    targetBytes,
    {
      operationName,
      supersedePlan,
      allowedModes,
      targetMode,
      checkpoint,
      checkpointName,
      beforeMutation,
    },
  );
  completePreparedRewrite(plan, record, {
    supersedePlan,
    checkpoint,
    checkpointName,
    beforeMutation,
  });
}

function preparedRemovalRecord(
  plan,
  filePath,
  sourceSnapshot,
  {
    operationName,
    supersedePlan = undefined,
    checkpoint = () => undefined,
    checkpointName,
    beforeMutation = () => undefined,
  },
) {
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    supersedePlan,
    extraPaths: [filePath],
  });
  const existing = readWriteAheadRecord(plan, supersedePlan);
  if (existing !== null) {
    if (
      existing.operation !== "remove" ||
      existing.operationName !== operationName ||
      existing.filePath !== filePath ||
      existing.sourceDigest !== sha256(canonicalJsonBytes(sourceSnapshot))
    ) {
      fail(
        "cutover_write_ahead_conflict",
        "A different cutover removal is already pending.",
      );
    }
    return existing;
  }
  if (!existsSync(filePath)) {
    syncDirectory(path.dirname(filePath));
    return null;
  }
  requireSnapshotMatch(sourceSnapshot, filePath, `Removal source ${filePath}`);
  const stats = lstatSync(filePath);
  if (
    (!stats.isFile() && !stats.isDirectory()) ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUid(stats) ||
    realpathSync(filePath) !== path.resolve(filePath)
  ) {
    fail("cutover_source_drift", `Removal source is unsafe: ${filePath}`);
  }
  const scope = writeAheadScope(plan, supersedePlan);
  const snapshotBytes = canonicalJsonBytes(sourceSnapshot);
  const record = {
    schemaVersion: 1,
    kind: CUTOVER_WRITE_AHEAD_KIND,
    operation: "remove",
    scope: scope.scope,
    scopeId: scope.scopeId,
    cutoverId: plan.parameters.cutoverId,
    operationName,
    filePath,
    quarantinePath: "",
    sourceDev: String(stats.dev),
    sourceIno: String(stats.ino),
    sourceMode: stats.mode & 0o7777,
    targetMode: null,
    sourceSize: snapshotBytes.length,
    sourceDigest: sha256(snapshotBytes),
    sourceBytesBase64: null,
    targetSize: 0,
    targetDigest: sha256(Buffer.alloc(0)),
    targetBytesBase64: null,
    sourceSnapshot,
    phase: "prepared",
    preparedAt: new Date().toISOString(),
    writtenAt: null,
  };
  record.quarantinePath = path.join(
    cutoverQuarantineRoot(plan),
    removalQuarantineId(record),
  );
  record.operationId = writeAheadOperationId(record);
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    supersedePlan,
    extraPaths: [filePath, record.quarantinePath],
  });
  ensurePrivateDirectory(path.dirname(record.quarantinePath), beforeMutation);
  checkpoint(`${checkpointName}-before-journal`, {
    filePath,
    operationId: record.operationId,
  });
  writeWriteAheadRecord(plan, record, supersedePlan, beforeMutation);
  checkpoint(`${checkpointName}-journal-durable`, {
    filePath,
    operationId: record.operationId,
  });
  return record;
}

function completePreparedRemoval(
  plan,
  record,
  {
    supersedePlan = undefined,
    checkpoint = () => undefined,
    checkpointName = "remove",
    beforeMutation = () => undefined,
  } = {},
) {
  const sourceExists = existsSync(record.filePath);
  const quarantineExists = existsSync(record.quarantinePath);
  if (sourceExists && quarantineExists) {
    fail(
      "cutover_write_ahead_conflict",
      "Cutover removal exists at both canonical and quarantine paths.",
    );
  }
  if (sourceExists) {
    requireSnapshotMatch(
      record.sourceSnapshot,
      record.filePath,
      "Cutover removal source",
    );
    const sourceStats = lstatSync(record.filePath);
    if (
      String(sourceStats.dev) !== record.sourceDev ||
      String(sourceStats.ino) !== record.sourceIno
    ) {
      fail(
        "cutover_source_drift",
        `Removal source generation changed: ${record.filePath}`,
      );
    }
    beforeMutation();
    renameSync(record.filePath, record.quarantinePath);
    checkpoint(`${checkpointName}-after-rename`, {
      filePath: record.filePath,
      quarantinePath: record.quarantinePath,
      operationId: record.operationId,
    });
    syncDirectory(path.dirname(record.filePath));
    syncDirectory(path.dirname(record.quarantinePath));
  }
  if (existsSync(record.quarantinePath)) {
    const quarantineStats = lstatSync(record.quarantinePath);
    if (
      String(quarantineStats.dev) !== record.sourceDev ||
      String(quarantineStats.ino) !== record.sourceIno ||
      quarantineStats.uid !== currentUid(quarantineStats) ||
      quarantineStats.isSymbolicLink() ||
      realpathSync(record.quarantinePath) !==
        path.resolve(record.quarantinePath)
    ) {
      fail(
        "cutover_write_ahead_conflict",
        "Cutover quarantine generation conflicts.",
      );
    }
    requireSnapshotMatch(
      record.sourceSnapshot,
      record.quarantinePath,
      "Cutover quarantine occurrence",
    );
    beforeMutation();
    rmSync(record.quarantinePath, { recursive: true, force: true });
    checkpoint(`${checkpointName}-after-quarantine-remove`, {
      quarantinePath: record.quarantinePath,
      operationId: record.operationId,
    });
  }
  syncDirectory(path.dirname(record.filePath));
  syncDirectory(path.dirname(record.quarantinePath));
  const written =
    record.phase === "written"
      ? record
      : { ...record, phase: "written", writtenAt: new Date().toISOString() };
  writeWriteAheadRecord(plan, written, supersedePlan, beforeMutation);
  checkpoint(`${checkpointName}-journal-written`, {
    filePath: record.filePath,
    operationId: record.operationId,
  });
  clearWriteAheadRecord(
    plan,
    checkpoint,
    `${checkpointName}-journal-unlinked`,
    { filePath: record.filePath, operationId: record.operationId },
    beforeMutation,
  );
  const quarantineRoot = cutoverQuarantineRoot(plan);
  if (existsSync(quarantineRoot) && readdirSync(quarantineRoot).length === 0) {
    beforeMutation();
    rmdirSync(quarantineRoot);
    syncDirectory(path.dirname(quarantineRoot));
  }
}

function removePathRecoverably(plan, filePath, sourceSnapshot, options) {
  const record = preparedRemovalRecord(plan, filePath, sourceSnapshot, options);
  if (record === null) return;
  completePreparedRemoval(plan, record, options);
}

function recoverPendingWriteAhead(
  plan,
  {
    supersedePlan = undefined,
    checkpoint = () => undefined,
    beforeMutation = () => undefined,
  } = {},
) {
  const record = readWriteAheadRecord(plan, supersedePlan);
  if (record === null) {
    const quarantineRoot = cutoverQuarantineRoot(plan);
    if (existsSync(quarantineRoot)) {
      requirePrivateDirectory(
        quarantineRoot,
        "Kernel guard cutover recovery quarantine",
      );
      if (readdirSync(quarantineRoot).length !== 0) {
        fail(
          "cutover_write_ahead_invalid",
          "Kernel guard cutover has orphaned quarantine evidence without a write-ahead record.",
        );
      }
      beforeMutation();
      rmdirSync(quarantineRoot);
      syncDirectory(path.dirname(quarantineRoot));
    }
    return;
  }
  const options = {
    supersedePlan: record.scope === "supersede" ? supersedePlan : undefined,
    checkpoint,
    checkpointName: record.operationName,
    beforeMutation,
  };
  if (record.operation === "rewrite") {
    completePreparedRewrite(plan, record, options);
  } else {
    completePreparedRemoval(plan, record, options);
  }
}

function installNoReplacePermanentMarker(
  filePath,
  checkpoint = () => undefined,
  checkpointName = "permanent-marker-linked",
  beforeMutation = () => undefined,
) {
  const bytes = automationKernelGuardMarkerBytes();
  const temporaryPath = `${filePath}.cutover.tmp`;
  if (existsSync(filePath) && existsSync(temporaryPath)) {
    checkpoint(`${checkpointName}-recovery-before-unlink`, {
      filePath,
      temporaryPath,
    });
  }
  recoverNoReplaceLink(filePath, temporaryPath, bytes, beforeMutation);
  if (exactMarkerFile(filePath)) {
    if (existsSync(temporaryPath)) {
      fail(
        "cutover_conflict",
        `Cutover marker temporary path conflicts: ${temporaryPath}`,
      );
    }
    syncDirectory(path.dirname(filePath));
    return;
  }
  if (existsSync(filePath)) {
    fail("cutover_conflict", `Cutover marker path is occupied: ${filePath}`);
  }
  prepareMarkerTemporaryFile(temporaryPath, beforeMutation);
  try {
    beforeMutation();
    linkSync(temporaryPath, filePath);
  } catch (error) {
    if (error?.code !== "EEXIST" || !exactMarkerFile(filePath)) throw error;
  }
  const current = lstatSync(filePath);
  const temporary = lstatSync(temporaryPath);
  if (current.dev !== temporary.dev || current.ino !== temporary.ino) {
    fail("cutover_conflict", `Cutover marker identity conflicts: ${filePath}`);
  }
  checkpoint(checkpointName, { filePath, temporaryPath });
  beforeMutation();
  unlinkSync(temporaryPath);
  syncDirectory(path.dirname(filePath));
  if (!exactMarkerFile(filePath)) {
    fail("cutover_conflict", `Cutover marker did not verify: ${filePath}`);
  }
}

function readOpenedBytes(descriptor, opened) {
  const bytes = Buffer.alloc(opened.size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(
      descriptor,
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
    if (count === 0) break;
    offset += count;
  }
  if (offset !== bytes.length) {
    fail(
      "cutover_source_drift",
      "Legacy marker source changed while being read.",
    );
  }
  return bytes;
}

function writeSnapshotArchive(
  expected,
  targetPath,
  beforeMutation = () => undefined,
) {
  if (expected.kind === "missing") {
    if (existsSync(targetPath)) {
      fail(
        "cutover_conflict",
        `Unexpected cutover archive entry: ${targetPath}`,
      );
    }
    return;
  }
  if (expected.kind === "file") {
    writeImmutable(targetPath, Buffer.from(expected.bytesBase64, "base64"), {
      beforeMutation,
    });
    return;
  }
  ensurePrivateDirectory(targetPath, beforeMutation);
  const expectedNames = expected.entries
    .map((entry) => path.basename(entry.path))
    .sort();
  const actualNames = readdirSync(targetPath).sort();
  const unexpected = actualNames.find((name) => !expectedNames.includes(name));
  if (unexpected !== undefined) {
    fail(
      "cutover_conflict",
      `Unexpected cutover archive entry: ${path.join(targetPath, unexpected)}`,
    );
  }
  for (const child of expected.entries) {
    writeSnapshotArchive(
      child,
      path.join(targetPath, path.basename(child.path)),
      beforeMutation,
    );
  }
}

function verifySnapshotArchive(expected, targetPath) {
  if (expected.kind === "missing") {
    if (existsSync(targetPath)) {
      fail(
        "cutover_conflict",
        `Unexpected cutover archive entry: ${targetPath}`,
      );
    }
    return;
  }
  if (expected.kind === "file") {
    const bytes = readPrivateMode600File(targetPath, expected.size);
    if (
      bytes.length !== expected.size ||
      sha256(bytes) !== expected.digest ||
      bytes.toString("base64") !== expected.bytesBase64
    ) {
      fail("cutover_conflict", `Cutover archive bytes changed: ${targetPath}`);
    }
    return;
  }
  requirePrivateDirectory(targetPath, `Cutover archive ${targetPath}`);
  const expectedNames = expected.entries
    .map((entry) => path.basename(entry.path))
    .sort();
  const actualNames = readdirSync(targetPath).sort();
  if (actualNames.join("\n") !== expectedNames.join("\n")) {
    fail(
      "cutover_conflict",
      `Cutover archive directory changed: ${targetPath}`,
    );
  }
  for (const child of expected.entries) {
    verifySnapshotArchive(
      child,
      path.join(targetPath, path.basename(child.path)),
    );
  }
}

function archiveLegacySources(
  plan,
  beforeMutation = () => undefined,
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const directory = artifactDirectory(plan);
  const movedRoot = path.join(directory, "legacy-paths");
  ensurePrivateDirectory(movedRoot, beforeMutation);
  const writer = sourceEntry(plan, paths.writerLock);
  const guards = sourceEntry(plan, paths.guardsRoot);
  writeSnapshotArchive(
    writer,
    path.join(movedRoot, "outcomes.jsonl.writer-lock"),
    beforeMutation,
  );
  writeSnapshotArchive(
    guards,
    path.join(movedRoot, "guards"),
    beforeMutation,
  );
  verifySnapshotArchive(
    writer,
    path.join(movedRoot, "outcomes.jsonl.writer-lock"),
  );
  verifySnapshotArchive(guards, path.join(movedRoot, "guards"));
  syncDirectory(movedRoot);
}

function verifyLegacyArchive(plan) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const movedRoot = path.join(artifactDirectory(plan), "legacy-paths");
  verifySnapshotArchive(
    sourceEntry(plan, paths.writerLock),
    path.join(movedRoot, "outcomes.jsonl.writer-lock"),
  );
  verifySnapshotArchive(
    sourceEntry(plan, paths.guardsRoot),
    path.join(movedRoot, "guards"),
  );
}

function removeUnlinkedClaimTemporary(
  filePath,
  plan,
  transaction,
  target,
  beforeMutation = () => undefined,
) {
  const temporaryPath = `${filePath}.cutover-claim.tmp`;
  if (!existsSync(temporaryPath)) return;
  const matches = transaction.claimGenerations.some((generation) =>
    exactPrivateFileBytes(
      temporaryPath,
      cutoverClaimBytes(plan, generation, target),
    ),
  );
  if (!matches) {
    fail(
      "cutover_supersede_conflict",
      `Cutover claim temporary bytes conflict at ${temporaryPath}.`,
    );
  }
  removePrivateTemporaryFile(temporaryPath, beforeMutation);
}

function restoreWriterClaim(
  plan,
  transaction,
  supersedePlan,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const expected = sourceEntry(plan, paths.writerLock);
  const target = "writer";
  recoverAnyClaimLink(
    paths.writerLock,
    plan,
    transaction,
    target,
    beforeMutation,
  );
  removeUnlinkedClaimTemporary(
    paths.writerLock,
    plan,
    transaction,
    target,
    beforeMutation,
  );
  if (expected.kind === "missing") {
    if (!existsSync(paths.writerLock)) return;
    if (
      claimGenerationForFile(paths.writerLock, plan, transaction, target) ===
      undefined
    ) {
      fail(
        "cutover_supersede_conflict",
        "Outcome writer claim changed before supersession.",
      );
    }
    removePathRecoverably(
      plan,
      paths.writerLock,
      snapshotPath(paths.writerLock),
      {
        operationName: "supersede-writer-remove",
        supersedePlan,
        checkpoint,
        checkpointName: "supersede-writer-remove",
        beforeMutation,
      },
    );
    return;
  }
  const expectedBytes = expectedFileBytes(expected);
  try {
    requireSnapshotMatch(expected, paths.writerLock, "Restored outcome writer");
    return;
  } catch (error) {
    if (error?.code !== "cutover_source_drift") throw error;
  }
  if (
    claimGenerationForFile(paths.writerLock, plan, transaction, target) ===
    undefined
  ) {
    fail(
      "cutover_supersede_conflict",
      "Outcome writer claim changed before supersession.",
    );
  }
  rewritePrivateFileInPlace(
    plan,
    paths.writerLock,
    priorClaimByteOptions(plan, transaction, target),
    expectedBytes,
    {
      checkpointName: "supersede-writer-before-restore",
      operationName: "supersede-writer-restore",
      supersedePlan,
      checkpoint,
      allowedModes: new Set([0o600]),
      targetMode: expected.mode,
      beforeMutation,
    },
  );
  requireSnapshotMatch(expected, paths.writerLock, "Restored outcome writer");
}

function guardExpectedOwner(expected) {
  return expected.kind === "directory"
    ? expected.entries.find(
        (entry) => path.basename(entry.path) === "owner.json",
      )
    : undefined;
}

function restoreGuardClaim(
  plan,
  transaction,
  supersedePlan,
  name,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const guard = paths.guards[name];
  const expected = plannedGuardEntry(plan, guard.directory);
  const target = `guard:${name}`;
  recoverAnyClaimLink(
    guard.owner,
    plan,
    transaction,
    target,
    beforeMutation,
  );
  removeUnlinkedClaimTemporary(
    guard.owner,
    plan,
    transaction,
    target,
    beforeMutation,
  );
  if (expected.kind === "missing") {
    if (!existsSync(guard.directory)) return;
    requireClaimDirectory(
      guard.directory,
      `Claim-created guard ${guard.directory}`,
    );
    const entries = readdirSync(guard.directory);
    if (
      entries.length !== 1 ||
      entries[0] !== "owner.json" ||
      claimGenerationForFile(guard.owner, plan, transaction, target) ===
        undefined
    ) {
      fail(
        "cutover_supersede_conflict",
        `Claim-created guard changed before supersession: ${guard.directory}`,
      );
    }
    removePathRecoverably(
      plan,
      guard.directory,
      snapshotPath(guard.directory),
      {
        operationName: `supersede-guard-${name}-remove`,
        supersedePlan,
        checkpoint,
        checkpointName: `supersede-guard-${name}-remove`,
        beforeMutation,
      },
    );
    return;
  }

  requireClaimDirectory(guard.directory, `Claimed guard ${guard.directory}`);
  if (existsSync(guard.inner)) {
    fail(
      "cutover_supersede_too_late",
      `Guard conversion already created ${guard.inner}.`,
    );
  }
  const expectedOwner = guardExpectedOwner(expected);
  if (expectedOwner === undefined) {
    if (existsSync(guard.owner)) {
      if (
        claimGenerationForFile(guard.owner, plan, transaction, target) ===
        undefined
      ) {
        fail(
          "cutover_supersede_conflict",
          `Guard claim changed before supersession: ${guard.owner}`,
        );
      }
      removePathRecoverably(plan, guard.owner, snapshotPath(guard.owner), {
        operationName: `supersede-guard-${name}-owner-remove`,
        supersedePlan,
        checkpoint,
        checkpointName: `supersede-guard-${name}-owner-remove`,
        beforeMutation,
      });
    }
  } else {
    try {
      requireSnapshotMatch(expectedOwner, guard.owner, "Restored guard owner");
    } catch (error) {
      if (error?.code !== "cutover_source_drift") throw error;
      if (
        claimGenerationForFile(guard.owner, plan, transaction, target) ===
        undefined
      ) {
        fail(
          "cutover_supersede_conflict",
          `Guard claim changed before supersession: ${guard.owner}`,
        );
      }
      rewritePrivateFileInPlace(
        plan,
        guard.owner,
        priorClaimByteOptions(plan, transaction, target),
        expectedFileBytes(expectedOwner),
        {
          checkpointName: "supersede-guard-before-restore",
          operationName: `supersede-guard-${name}-restore`,
          supersedePlan,
          checkpoint,
          allowedModes: new Set([0o600]),
          targetMode: expectedOwner.mode,
          beforeMutation,
        },
      );
    }
  }
  if ((lstatSync(guard.directory).mode & 0o7777) !== expected.mode) {
    beforeMutation();
    chmodSync(guard.directory, expected.mode);
    syncDirectory(path.dirname(guard.directory));
  }
  requireSnapshotMatch(expected, guard.directory, `Restored guard ${name}`);
}

function restoreCutoverClaims(
  plan,
  transaction,
  supersedePlan,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  requireSupersedeStillPreMarker(plan);
  restoreWriterClaim(
    plan,
    transaction,
    supersedePlan,
    checkpoint,
    beforeMutation,
  );
  for (const name of AUTOMATION_KERNEL_GUARD_NAMES) {
    restoreGuardClaim(
      plan,
      transaction,
      supersedePlan,
      name,
      checkpoint,
      beforeMutation,
    );
  }
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  requireSnapshotMatch(
    sourceEntry(plan, paths.writerLock),
    paths.writerLock,
    "Restored outcome writer source",
  );
  requireSnapshotMatch(
    sourceEntry(plan, paths.guardsRoot),
    paths.guardsRoot,
    "Restored guard root source",
  );
}

function plannedGuardEntry(plan, guardPath) {
  return sourceEntry(plan, guardPath) ?? { path: guardPath, kind: "missing" };
}

function requireClaimDirectory(directoryPath, label) {
  let stats;
  try {
    stats = lstatSync(directoryPath);
  } catch (error) {
    fail(
      "cutover_source_drift",
      `${label} is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUid(stats) ||
    ![0o700, 0o755].includes(stats.mode & 0o7777) ||
    realpathSync(directoryPath) !== path.resolve(directoryPath)
  ) {
    fail("cutover_source_drift", `${label} changed after planning.`);
  }
  return stats;
}

function expectedFileBytes(expected) {
  return expected?.kind === "file"
    ? Buffer.from(expected.bytesBase64, "base64")
    : null;
}

function priorClaimByteOptions(plan, transaction, target) {
  return transaction.claimGenerations.map((generation) =>
    cutoverClaimBytes(plan, generation, target),
  );
}

function installWriterClaim(
  plan,
  transaction,
  generation,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const filePath = paths.writerLock;
  const target = "writer";
  const targetBytes = cutoverClaimBytes(plan, generation, target);
  recoverAnyClaimLink(
    filePath,
    plan,
    transaction,
    target,
    beforeMutation,
  );
  recoverPermanentMarkerLink(
    filePath,
    beforeMutation,
    checkpoint,
    "writer-marker-linked",
  );
  if (
    exactMarkerFile(filePath) ||
    exactPrivateFileBytes(filePath, targetBytes)
  ) {
    syncDirectory(path.dirname(filePath));
    return;
  }
  const expected = sourceEntry(plan, filePath) ?? {
    path: filePath,
    kind: "missing",
  };
  if (!existsSync(filePath)) {
    if (expected.kind !== "missing") {
      fail(
        "cutover_source_drift",
        "Legacy outcome writer disappeared before claim.",
      );
    }
    installNoReplaceExactBytes(filePath, targetBytes, {
      checkpoint,
      checkpointName: "writer-claim-linked",
      temporarySuffix: "cutover-claim",
      beforeMutation,
    });
    checkpoint("writer-claim-durable", { filePath });
    return;
  }
  const priorClaims = priorClaimByteOptions(plan, transaction, target);
  const expectedBytes = expectedFileBytes(expected);
  const previousClaim = claimGenerationForFile(
    filePath,
    plan,
    transaction,
    target,
  );
  if (
    previousClaim === undefined &&
    legacyOwnerIsLive(readLegacyOwner(filePath))
  ) {
    fail(
      "cutover_old_guard_busy",
      "An older outcome writer still owns its lock.",
    );
  }
  const allowedBytes = [
    ...priorClaims,
    ...(expectedBytes === null ? [] : [expectedBytes]),
  ];
  if (allowedBytes.length === 0) {
    fail(
      "cutover_source_drift",
      "Unexpected outcome writer appeared before claim.",
    );
  }
  rewritePrivateFileInPlace(plan, filePath, allowedBytes, targetBytes, {
    checkpoint,
    checkpointName: "writer-claim-before-write",
    operationName: "writer-claim",
    allowedModes: new Set([
      0o600,
      ...(expected?.kind === "file" ? [expected.mode] : []),
    ]),
    beforeMutation,
  });
  checkpoint("writer-claim-durable", { filePath });
}

function validateGuardClaimProgress(
  plan,
  transaction,
  guard,
  expected,
  target,
) {
  requireClaimDirectory(guard.directory, `Legacy guard ${guard.directory}`);
  const expectedByName = new Map(
    expected.kind === "directory"
      ? expected.entries.map((entry) => [path.basename(entry.path), entry])
      : [],
  );
  const allowedNames = new Set([
    ...expectedByName.keys(),
    "owner.json",
    "kernel.lock",
  ]);
  for (const name of readdirSync(guard.directory)) {
    const currentPath = path.join(guard.directory, name);
    if (!allowedNames.has(name)) {
      fail(
        "cutover_source_drift",
        `Unexpected legacy guard entry appeared: ${currentPath}`,
      );
    }
    if (
      name === "owner.json" &&
      (exactMarkerFile(currentPath) ||
        claimGenerationForFile(currentPath, plan, transaction, target) !==
          undefined)
    ) {
      continue;
    }
    if (name === "owner.json" && !expectedByName.has(name)) {
      continue;
    }
    if (name === "kernel.lock" && exactMarkerFile(currentPath)) continue;
    const expectedEntry = expectedByName.get(name);
    if (expectedEntry === undefined) {
      fail(
        "cutover_source_drift",
        `Unexpected legacy guard entry appeared: ${currentPath}`,
      );
    }
    requireSnapshotMatch(
      expectedEntry,
      currentPath,
      `Legacy guard entry ${currentPath}`,
    );
  }
  for (const [name] of expectedByName) {
    if (!existsSync(path.join(guard.directory, name))) {
      fail(
        "cutover_source_drift",
        `Planned legacy guard entry disappeared: ${path.join(guard.directory, name)}`,
      );
    }
  }
}

function installGuardClaim(
  plan,
  transaction,
  generation,
  name,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const guard = paths.guards[name];
  const expected = plannedGuardEntry(plan, guard.directory);
  const target = `guard:${name}`;
  const targetBytes = cutoverClaimBytes(plan, generation, target);
  recoverAnyClaimLink(
    guard.owner,
    plan,
    transaction,
    target,
    beforeMutation,
  );
  recoverPermanentMarkerLink(
    guard.owner,
    beforeMutation,
    checkpoint,
    "guard-owner-marker-linked",
  );
  recoverPermanentMarkerLink(
    guard.inner,
    beforeMutation,
    checkpoint,
    "guard-inner-marker-linked",
  );
  if (exactMarkerDirectory(guard)) return;
  if (!existsSync(guard.directory)) {
    if (expected.kind !== "missing") {
      fail(
        "cutover_source_drift",
        `Legacy guard path disappeared: ${guard.directory}`,
      );
    }
    checkpoint("guard-claim-before-mkdir", {
      guardName: name,
      directory: guard.directory,
    });
    try {
      beforeMutation();
      mkdirSync(guard.directory, { mode: 0o700 });
      beforeMutation();
      chmodSync(guard.directory, 0o700);
      syncDirectory(path.dirname(guard.directory));
      checkpoint("guard-claim-directory-durable", {
        guardName: name,
        directory: guard.directory,
      });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  validateGuardClaimProgress(plan, transaction, guard, expected, target);
  if (exactMarkerFile(guard.owner)) return;
  if (!existsSync(guard.owner)) {
    try {
      installNoReplaceExactBytes(guard.owner, targetBytes, {
        checkpoint,
        checkpointName: "guard-claim-linked",
        temporarySuffix: "cutover-claim",
        beforeMutation,
      });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = readLegacyOwner(guard.owner);
      if (legacyOwnerIsLive(owner)) {
        fail(
          "cutover_old_guard_busy",
          `An older guard owns ${guard.directory}.`,
        );
      }
      fail(
        "cutover_source_drift",
        `Unexpected guard owner appeared: ${guard.owner}`,
      );
    }
  } else if (!exactPrivateFileBytes(guard.owner, targetBytes)) {
    const previousClaim = claimGenerationForFile(
      guard.owner,
      plan,
      transaction,
      target,
    );
    const expectedOwner =
      expected.kind === "directory"
        ? expected.entries.find(
            (entry) => path.basename(entry.path) === "owner.json",
          )
        : undefined;
    if (
      previousClaim === undefined &&
      legacyOwnerIsLive(readLegacyOwner(guard.owner))
    ) {
      fail("cutover_old_guard_busy", `An older guard owns ${guard.directory}.`);
    }
    const expectedOwnerBytes = expectedFileBytes(expectedOwner);
    const allowedBytes = [
      ...priorClaimByteOptions(plan, transaction, target),
      ...(expectedOwnerBytes === null ? [] : [expectedOwnerBytes]),
    ];
    if (allowedBytes.length === 0) {
      fail(
        "cutover_source_drift",
        `Unexpected guard owner appeared: ${guard.owner}`,
      );
    }
    rewritePrivateFileInPlace(plan, guard.owner, allowedBytes, targetBytes, {
      checkpoint,
      checkpointName: "guard-claim-before-write",
      operationName: `guard-${name}-claim`,
      allowedModes: new Set([
        0o600,
        ...(expectedOwner?.kind === "file" ? [expectedOwner.mode] : []),
      ]),
      beforeMutation,
    });
  }
  checkpoint("guard-claim-durable", {
    guardName: name,
    directory: guard.directory,
  });
  validateGuardClaimProgress(plan, transaction, guard, expected, target);
  if (!exactPrivateFileBytes(guard.owner, targetBytes)) {
    fail(
      "cutover_conflict",
      `Cutover guard claim did not verify: ${guard.directory}`,
    );
  }
}

function installCutoverClaims(
  plan,
  transaction,
  generation,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  installWriterClaim(
    plan,
    transaction,
    generation,
    checkpoint,
    beforeMutation,
  );
  for (const name of AUTOMATION_KERNEL_GUARD_NAMES) {
    installGuardClaim(
      plan,
      transaction,
      generation,
      name,
      checkpoint,
      beforeMutation,
    );
  }
}

function validateCutoverClaims(plan, transaction, generation) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  if (
    !exactMarkerFile(paths.writerLock) &&
    !exactClaimFile(paths.writerLock, plan, generation, "writer")
  ) {
    fail(
      "cutover_claim_conflict",
      "Outcome writer claim changed before activation.",
    );
  }
  for (const name of AUTOMATION_KERNEL_GUARD_NAMES) {
    const guard = paths.guards[name];
    const expected = plannedGuardEntry(plan, guard.directory);
    if (exactMarkerDirectory(guard)) continue;
    const target = `guard:${name}`;
    validateGuardClaimProgress(plan, transaction, guard, expected, target);
    if (
      !exactMarkerFile(guard.owner) &&
      !exactClaimFile(guard.owner, plan, generation, target)
    ) {
      fail(
        "cutover_claim_conflict",
        `Guard claim changed before activation: ${name}`,
      );
    }
  }
}

function installPermanentTargets(
  plan,
  transaction,
  generation,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  if (!exactMarkerFile(paths.writerLock)) {
    const claimBytes = cutoverClaimBytes(plan, generation, "writer");
    rewritePrivateFileInPlace(
      plan,
      paths.writerLock,
      [claimBytes],
      automationKernelGuardMarkerBytes(),
      {
        checkpoint,
        checkpointName: "writer-marker-before-write",
        operationName: "writer-marker",
        allowedModes: new Set([0o600]),
        beforeMutation,
      },
    );
    checkpoint("writer-marker-durable", { filePath: paths.writerLock });
  } else {
    syncDirectory(path.dirname(paths.writerLock));
  }
  for (const name of AUTOMATION_KERNEL_GUARD_NAMES) {
    const guard = paths.guards[name];
    const expected = plannedGuardEntry(plan, guard.directory);
    const target = `guard:${name}`;
    if (!exactMarkerFile(guard.owner)) {
      rewritePrivateFileInPlace(
        plan,
        guard.owner,
        [cutoverClaimBytes(plan, generation, target)],
        automationKernelGuardMarkerBytes(),
        {
          checkpoint,
          checkpointName: "guard-owner-marker-before-write",
          operationName: `guard-${name}-owner-marker`,
          allowedModes: new Set([0o600]),
          beforeMutation,
        },
      );
      checkpoint("guard-owner-marker-durable", {
        guardName: name,
        filePath: guard.owner,
      });
    }
    if (!exactMarkerFile(guard.inner)) {
      installNoReplacePermanentMarker(
        guard.inner,
        checkpoint,
        "guard-inner-marker-linked",
        beforeMutation,
      );
      checkpoint("guard-inner-marker-durable", {
        guardName: name,
        filePath: guard.inner,
      });
    }
    if ((lstatSync(guard.directory).mode & 0o7777) !== 0o700) {
      beforeMutation();
      chmodSync(guard.directory, 0o700);
      syncDirectory(path.dirname(guard.directory));
    }
    const expectedByName = new Map(
      expected.kind === "directory"
        ? expected.entries.map((entry) => [path.basename(entry.path), entry])
        : [],
    );
    for (const entryName of readdirSync(guard.directory)) {
      if (entryName === "owner.json" || entryName === "kernel.lock") continue;
      const currentPath = path.join(guard.directory, entryName);
      const expectedEntry = expectedByName.get(entryName);
      if (expectedEntry === undefined) {
        fail(
          "cutover_source_drift",
          `Unexpected legacy guard entry appeared: ${currentPath}`,
        );
      }
    }
    for (const [entryName, expectedEntry] of expectedByName) {
      if (entryName === "owner.json" || entryName === "kernel.lock") continue;
      const currentPath = path.join(guard.directory, entryName);
      if (!existsSync(currentPath)) {
        syncDirectory(guard.directory);
        continue;
      }
      removePathRecoverably(plan, currentPath, expectedEntry, {
        operationName: `guard-${name}-remove-${sha256(Buffer.from(entryName)).slice(0, 16)}`,
        checkpoint,
        checkpointName: `guard-${name}-legacy-remove`,
        beforeMutation,
      });
    }
    syncDirectory(guard.directory);
    if (!exactMarkerDirectory(guard)) {
      fail(
        "cutover_conflict",
        `Cutover guard did not verify: ${guard.directory}`,
      );
    }
  }
  const plannedGuards = sourceEntry(plan, paths.guardsRoot);
  const canonicalNames = new Set(
    AUTOMATION_KERNEL_GUARD_NAMES.map((name) => `${name}.lock`),
  );
  for (const entry of plannedGuards.entries) {
    const name = path.basename(entry.path);
    if (canonicalNames.has(name)) continue;
    if (!existsSync(entry.path)) {
      const permanentSetReady =
        exactMarkerFile(paths.writerLock) &&
        AUTOMATION_KERNEL_GUARD_NAMES.every((guardName) =>
          exactMarkerDirectory(paths.guards[guardName]),
        );
      if (!permanentSetReady) {
        fail(
          "cutover_source_drift",
          `Planned abandoned guard disappeared early: ${entry.path}`,
        );
      }
      continue;
    }
    removePathRecoverably(plan, entry.path, entry, {
      operationName: `abandoned-guard-remove-${sha256(Buffer.from(entry.path)).slice(0, 16)}`,
      checkpoint,
      checkpointName: "abandoned-guard-remove",
      beforeMutation,
    });
  }
  syncDirectory(paths.guardsRoot);
  validatePermanentTargets(plan);
}

function validatePermanentTargets(plan) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const expectedNames = AUTOMATION_KERNEL_GUARD_NAMES.map(
    (name) => `${name}.lock`,
  ).sort();
  const actualNames = readdirSync(paths.guardsRoot).sort();
  if (actualNames.join("\n") !== expectedNames.join("\n")) {
    fail(
      "cutover_conflict",
      "Permanent guard root contains unexpected entries.",
    );
  }
  if (!exactMarkerFile(paths.writerLock)) {
    fail("cutover_conflict", "Permanent outcome writer marker did not verify.");
  }
  if (!exactMarkerFile(paths.bootstrapLock)) {
    fail("cutover_conflict", "Permanent bootstrap marker did not verify.");
  }
  for (const name of AUTOMATION_KERNEL_GUARD_NAMES) {
    if (!exactMarkerDirectory(paths.guards[name])) {
      fail("cutover_conflict", `Permanent guard ${name} did not verify.`);
    }
  }
}

function buildReceipt(plan, transaction) {
  if (
    transaction.phase !== "receipt-prepared" ||
    !Number.isFinite(Date.parse(String(transaction.completedAt ?? "")))
  ) {
    fail(
      "cutover_transaction_invalid",
      "Kernel guard cutover receipt is not durably prepared.",
    );
  }
  const expectedTransactionBytes = prettyJsonBytes(transaction);
  const transactionBytes = readPrivateMode600File(
    transactionPath(plan),
    expectedTransactionBytes.length,
  );
  if (!transactionBytes.equals(expectedTransactionBytes)) {
    fail(
      "cutover_transaction_invalid",
      "Kernel guard cutover transaction bytes are not canonical.",
    );
  }
  const receiptAuthorization = transaction.authorizations.at(-1);
  const core = {
    schemaVersion: 1,
    policy: AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
    cutoverId: plan.parameters.cutoverId,
    stateRoot: plan.parameters.stateRoot,
    markerDigest: AUTOMATION_KERNEL_GUARD_MARKER_DIGEST,
    guardNames: [...AUTOMATION_KERNEL_GUARD_NAMES],
    sourceSnapshotDigest: plan.parameters.sourceSnapshotDigest,
    archiveManifestDigest: plan.parameters.archiveManifestDigest,
    transactionDigest: sha256(transactionBytes),
    intentDigest: plan.intentDigest,
    confirmationId: receiptAuthorization.confirmationId,
    confirmationDigest: receiptAuthorization.confirmationDigest,
    completedAt: transaction.completedAt,
  };
  const artifactBytes = canonicalAutomationKernelGuardReceiptBytes(core);
  const artifactReceipt = path.join(artifactDirectory(plan), "receipt.json");
  return {
    core,
    artifactBytes,
    artifactReceipt,
    global: {
      ...core,
      artifactReceipt,
      artifactReceiptDigest: sha256(artifactBytes),
    },
  };
}

function requireExactPrivateBytes(filePath, expectedBytes, label) {
  const actual = readPrivateMode600File(filePath, expectedBytes.length);
  if (!actual.equals(expectedBytes)) {
    fail("cutover_conflict", `${label} changed after it was prepared.`);
  }
}

function verifyPreparedArtifacts(
  plan,
  transaction,
  { requireReceipt = true } = {},
) {
  const directory = artifactDirectory(plan);
  requirePrivateDirectory(directory, "Kernel guard cutover artifact directory");
  const authorizationDirectory = path.join(directory, "authorizations");
  requirePrivateDirectory(
    authorizationDirectory,
    "Kernel guard cutover authorization directory",
  );
  const expectedAuthorizationNames = [
    "prepared-authorization.json",
    ...new Set(
      transaction.authorizations.map((authorization) =>
        path.basename(authorization.confirmationArtifact),
      ),
    ),
  ].sort();
  const actualAuthorizationNames = readdirSync(authorizationDirectory).sort();
  if (
    actualAuthorizationNames.join("\n") !==
    expectedAuthorizationNames.join("\n")
  ) {
    fail(
      "cutover_conflict",
      "Cutover authorization evidence set changed after preparation.",
    );
  }
  const receiptPath = path.join(directory, "receipt.json");
  const receiptTemporaryPath = `${receiptPath}.cutover.tmp`;
  const receiptExists = existsSync(receiptPath);
  const receiptTemporaryExists = existsSync(receiptTemporaryPath);
  const expectedArtifactNames = [
    "authorizations",
    "legacy-locks.json",
    "legacy-paths",
    "plan.json",
    "source-snapshot.json",
    ...(receiptExists || requireReceipt ? ["receipt.json"] : []),
    ...(!requireReceipt && receiptTemporaryExists
      ? ["receipt.json.cutover.tmp"]
      : []),
  ].sort();
  const actualArtifactNames = readdirSync(directory).sort();
  if (actualArtifactNames.join("\n") !== expectedArtifactNames.join("\n")) {
    fail(
      "cutover_conflict",
      "Cutover prepared artifact set changed before activation.",
    );
  }
  requireExactPrivateBytes(
    path.join(directory, "plan.json"),
    prettyJsonBytes(plan),
    "Cutover plan artifact",
  );
  requireExactPrivateBytes(
    path.join(directory, "source-snapshot.json"),
    canonicalJsonBytes(plan.sourceSnapshot),
    "Cutover source snapshot artifact",
  );
  requireExactPrivateBytes(
    path.join(directory, "legacy-locks.json"),
    canonicalJsonBytes(legacyManifest(plan)),
    "Cutover legacy manifest artifact",
  );
  verifyLegacyArchive(plan);
  if (transaction.phase === "receipt-prepared") {
    const receipt = buildReceipt(plan, transaction);
    if (!requireReceipt && (receiptExists || receiptTemporaryExists)) {
      requireImmutableTargetPreflight(
        receipt.artifactReceipt,
        receipt.artifactBytes,
      );
    } else if (receiptExists) {
      requireExactPrivateBytes(
        receipt.artifactReceipt,
        receipt.artifactBytes,
        "Cutover receipt artifact",
      );
    } else if (requireReceipt) {
      fail(
        "cutover_conflict",
        "Cutover receipt artifact is missing after terminal preparation.",
      );
    }
  }
}

function prepareBootstrapLock(
  plan,
  beforeMutation = () => undefined,
) {
  const lockPath = path.join(
    plan.parameters.stateRoot,
    "control",
    "kernel-guard-cutover.bootstrap.lock",
  );
  installNoReplacePermanentMarker(
    lockPath,
    () => undefined,
    "bootstrap-marker-linked",
    beforeMutation,
  );
  return lockPath;
}

function validateReceiptPreparedActivation(
  plan,
  transaction,
  { requireReceipt },
) {
  requireQuiescence(plan);
  validateStaticSource(plan);
  requireLocalFilesystem(plan.parameters.stateRoot, { plan, transaction });
  if (readWriteAheadRecord(plan) !== null) {
    fail(
      "cutover_write_ahead_invalid",
      "Terminal cutover recovery has a pending filesystem mutation.",
    );
  }
  if (existsSync(cutoverQuarantineRoot(plan))) {
    fail(
      "cutover_write_ahead_invalid",
      "Terminal cutover recovery has quarantine residue.",
    );
  }
  validatePermanentTargets(plan);
  verifyPreparedArtifacts(plan, transaction, { requireReceipt });
}

function finishReceiptPreparedCutover(
  plan,
  transaction,
  checkpoint = () => undefined,
) {
  if (transaction.phase !== "receipt-prepared") {
    fail(
      "cutover_transaction_invalid",
      "Kernel guard cutover is not durably prepared for activation.",
    );
  }
  validateReceiptPreparedActivation(plan, transaction, {
    requireReceipt: false,
  });
  const receipt = buildReceipt(plan, transaction);
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  requireImmutableTargetPreflight(
    receipt.artifactReceipt,
    receipt.artifactBytes,
  );
  requireImmutableTargetPreflight(
    paths.globalReceipt,
    prettyJsonBytes(receipt.global),
  );
  writeImmutable(receipt.artifactReceipt, receipt.artifactBytes, {
    checkpoint,
    linkedCheckpointName: "receipt-artifact-linked",
    beforeFinalize() {
      validateReceiptPreparedActivation(plan, transaction, {
        requireReceipt: false,
      });
    },
  });
  checkpoint("receipt-artifact-durable", {
    filePath: receipt.artifactReceipt,
  });
  validateReceiptPreparedActivation(plan, transaction, {
    requireReceipt: true,
  });
  writeImmutable(paths.globalReceipt, prettyJsonBytes(receipt.global), {
    checkpoint,
    linkedCheckpointName: "global-receipt-linked",
    beforeFinalize() {
      validateReceiptPreparedActivation(plan, transaction, {
        requireReceipt: true,
      });
    },
  });
  checkpoint("global-receipt-durable", {
    filePath: paths.globalReceipt,
  });
  validateReceiptPreparedActivation(plan, transaction, {
    requireReceipt: true,
  });
  const inspection = inspectAutomationKernelGuardCutover(
    plan.parameters.stateRoot,
  );
  if (!inspection.ready) {
    fail(
      "cutover_verification_failed",
      "Completed kernel guard cutover did not verify.",
      { problems: inspection.problems },
    );
  }
  return inspection.receipt;
}

function supersedeEvidencePaths(oldPlan, supersedePlan) {
  const directory = path.join(
    artifactDirectory(oldPlan),
    "superseded",
    supersedePlan.parameters.supersedeId,
  );
  return {
    directory,
    plan: path.join(directory, "supersede-plan.json"),
    transaction: path.join(directory, "superseded-transaction.json"),
    receipt: path.join(directory, "receipt.json"),
  };
}

function supersedeReceiptKeys() {
  return [
    "archiveManifestDigest",
    "claimGenerationsDigest",
    "confirmationBytesBase64",
    "confirmationDigest",
    "confirmationId",
    "confirmationPath",
    "confirmationRawDigest",
    "confirmationValidatedAt",
    "currentTaskDigest",
    "cutoverId",
    "intentDigest",
    "kind",
    "oldPlanDigest",
    "policy",
    "schemaVersion",
    "sourceSnapshotDigest",
    "stateRoot",
    "supersedeId",
    "supersedePlanDigest",
    "supersededAt",
    "taskId",
    "transactionDigest",
    "transactionPhase",
  ].sort();
}

function supersedeAuthorizationFields(supersedePlan, authorization) {
  const confirmationBytes = readPrivateMode600File(
    authorization.confirmationFile,
    64 * 1024,
  );
  let confirmation;
  try {
    confirmation = JSON.parse(fatalDecoder.decode(confirmationBytes));
  } catch {
    fail(
      "cutover_authorization_invalid",
      "Validated supersede owner confirmation bytes changed.",
    );
  }
  if (
    ownerGovernanceIntentDigest(confirmation) !== authorization.digest ||
    confirmation.confirmationId !==
      authorization.confirmation.confirmationId ||
    confirmation.taskId !== supersedePlan.taskId ||
    confirmation.intent?.action !== CUTOVER_SUPERSEDE_ACTION ||
    confirmation.intentDigest !== supersedePlan.intentDigest ||
    ownerGovernanceIntentDigest(confirmation.intent) !==
      supersedePlan.intentDigest
  ) {
    fail(
      "cutover_authorization_invalid",
      "Validated supersede owner confirmation bytes changed.",
    );
  }
  return {
    confirmationId: confirmation.confirmationId,
    confirmationDigest: authorization.digest,
    confirmationPath: authorization.confirmationFile,
    confirmationBytesBase64: confirmationBytes.toString("base64"),
    confirmationRawDigest: sha256(confirmationBytes),
    confirmationValidatedAt: new Date().toISOString(),
  };
}

function supersedeReceiptAuthorizationIsValid(receipt, supersedePlan) {
  let bytes;
  let confirmation;
  try {
    bytes = Buffer.from(receipt.confirmationBytesBase64, "base64");
    if (
      bytes.toString("base64") !== receipt.confirmationBytesBase64 ||
      sha256(bytes) !== receipt.confirmationRawDigest
    ) {
      return false;
    }
    confirmation = JSON.parse(fatalDecoder.decode(bytes));
  } catch {
    return false;
  }
  const requiredKeys = [
    "approvalSource",
    "approvedAt",
    "approvedBy",
    "confirmationId",
    "expiresAt",
    "intent",
    "intentDigest",
    "kind",
    "ownerApprovalReference",
    "schemaVersion",
    "taskId",
  ].sort();
  const source = confirmation?.approvalSource;
  const approvedAtMs = Date.parse(String(confirmation?.approvedAt ?? ""));
  const expiresAtMs = Date.parse(String(confirmation?.expiresAt ?? ""));
  const validatedAtMs = Date.parse(
    String(receipt.confirmationValidatedAt ?? ""),
  );
  const supersededAtMs = Date.parse(String(receipt.supersededAt ?? ""));
  return (
    confirmation?.schemaVersion === 1 &&
    confirmation?.kind === "owner-confirmation" &&
    Object.keys(confirmation).sort().join("\n") === requiredKeys.join("\n") &&
    confirmation.confirmationId === receipt.confirmationId &&
    confirmation.approvedBy === "AubreyF" &&
    typeof confirmation.ownerApprovalReference === "string" &&
    confirmation.ownerApprovalReference.trim() !== "" &&
    source !== null &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    Object.keys(source).sort().join("\n") === "kind\nreference" &&
    source.kind === "current-task" &&
    typeof source.reference === "string" &&
    source.reference.trim() !== "" &&
    confirmation.taskId === supersedePlan.taskId &&
    confirmation.intent?.taskId === supersedePlan.taskId &&
    confirmation.intent?.action === CUTOVER_SUPERSEDE_ACTION &&
    confirmation.intentDigest === supersedePlan.intentDigest &&
    ownerGovernanceIntentDigest(confirmation.intent) ===
      supersedePlan.intentDigest &&
    ownerGovernanceIntentDigest(confirmation) === receipt.confirmationDigest &&
    path.isAbsolute(receipt.confirmationPath) &&
    path.resolve(receipt.confirmationPath) === receipt.confirmationPath &&
    isCanonicalTimestamp(confirmation.approvedAt) &&
    isCanonicalTimestamp(confirmation.expiresAt) &&
    isCanonicalTimestamp(receipt.confirmationValidatedAt) &&
    Number.isFinite(approvedAtMs) &&
    Number.isFinite(expiresAtMs) &&
    Number.isFinite(validatedAtMs) &&
    Number.isFinite(supersededAtMs) &&
    expiresAtMs > approvedAtMs &&
    validatedAtMs >= approvedAtMs &&
    validatedAtMs < expiresAtMs &&
    supersededAtMs >= validatedAtMs &&
    supersededAtMs < expiresAtMs
  );
}

function validateSupersedeReceipt(receipt, supersedePlan) {
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    Object.keys(receipt).sort().join("\n") !==
      supersedeReceiptKeys().join("\n") ||
    receipt.schemaVersion !== 1 ||
    receipt.kind !== CUTOVER_SUPERSEDE_RECEIPT_KIND ||
    receipt.policy !== AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY ||
    receipt.taskId !== supersedePlan.taskId ||
    receipt.stateRoot !== supersedePlan.parameters.stateRoot ||
    receipt.cutoverId !== supersedePlan.parameters.cutoverId ||
    receipt.supersedeId !== supersedePlan.parameters.supersedeId ||
    receipt.oldPlanDigest !== supersedePlan.parameters.oldPlanDigest ||
    receipt.transactionDigest !== supersedePlan.parameters.transactionDigest ||
    receipt.transactionPhase !== supersedePlan.parameters.transactionPhase ||
    receipt.claimGenerationsDigest !==
      supersedePlan.parameters.claimGenerationsDigest ||
    receipt.sourceSnapshotDigest !==
      supersedePlan.parameters.sourceSnapshotDigest ||
    receipt.archiveManifestDigest !==
      supersedePlan.parameters.archiveManifestDigest ||
    receipt.currentTaskDigest !== supersedePlan.parameters.currentTaskDigest ||
    receipt.intentDigest !== supersedePlan.intentDigest ||
    receipt.supersedePlanDigest !== sha256(canonicalJsonBytes(supersedePlan)) ||
    !IDENTIFIER_PATTERN.test(String(receipt.confirmationId ?? "")) ||
    !SHA256_PATTERN.test(String(receipt.confirmationDigest ?? "")) ||
    !SHA256_PATTERN.test(String(receipt.confirmationRawDigest ?? "")) ||
    !supersedeReceiptAuthorizationIsValid(receipt, supersedePlan) ||
    !isCanonicalTimestamp(receipt.supersededAt)
  ) {
    fail(
      "cutover_supersede_conflict",
      "Kernel guard cutover supersede receipt conflicts.",
    );
  }
  return receipt;
}

function readSupersedeReceipt(oldPlan, supersedePlan) {
  const evidence = supersedeEvidencePaths(oldPlan, supersedePlan);
  if (!existsSync(evidence.receipt)) return null;
  let receipt;
  const bytes = readPrivateMode600File(
    evidence.receipt,
    1024 * 1024,
    new Set([1, 2]),
  );
  requireImmutableTargetPreflight(evidence.receipt, bytes);
  try {
    receipt = JSON.parse(fatalDecoder.decode(bytes));
  } catch {
    fail(
      "cutover_supersede_conflict",
      "Kernel guard cutover supersede receipt is malformed.",
    );
  }
  validateSupersedeReceipt(receipt, supersedePlan);
  if (!bytes.equals(prettyJsonBytes(receipt))) {
    fail(
      "cutover_supersede_conflict",
      "Kernel guard cutover supersede receipt bytes are not canonical.",
    );
  }
  return receipt;
}

function writeSupersedePreparedEvidence(
  oldPlan,
  supersedePlan,
  transactionBytes,
  beforeMutation = () => undefined,
) {
  const directory = artifactDirectory(oldPlan);
  ensurePrivateDirectory(directory, beforeMutation);
  writeImmutable(path.join(directory, "plan.json"), prettyJsonBytes(oldPlan), {
    beforeMutation,
  });
  writeImmutable(
    path.join(directory, "source-snapshot.json"),
    canonicalJsonBytes(oldPlan.sourceSnapshot),
    { beforeMutation },
  );
  writeImmutable(
    path.join(directory, "legacy-locks.json"),
    canonicalJsonBytes(legacyManifest(oldPlan)),
    { beforeMutation },
  );
  archiveLegacySources(oldPlan, beforeMutation);
  verifyLegacyArchive(oldPlan);
  const evidence = supersedeEvidencePaths(oldPlan, supersedePlan);
  ensurePrivateDirectory(evidence.directory, beforeMutation);
  writeImmutable(evidence.plan, prettyJsonBytes(supersedePlan), {
    beforeMutation,
  });
  writeImmutable(evidence.transaction, transactionBytes, { beforeMutation });
  return evidence;
}

function verifySupersedeEvidence(oldPlan, supersedePlan, transactionBytes) {
  const oldDirectory = artifactDirectory(oldPlan);
  requireExactPrivateBytes(
    path.join(oldDirectory, "plan.json"),
    prettyJsonBytes(oldPlan),
    "Superseded cutover plan artifact",
  );
  requireExactPrivateBytes(
    path.join(oldDirectory, "source-snapshot.json"),
    canonicalJsonBytes(oldPlan.sourceSnapshot),
    "Superseded cutover source artifact",
  );
  requireExactPrivateBytes(
    path.join(oldDirectory, "legacy-locks.json"),
    canonicalJsonBytes(legacyManifest(oldPlan)),
    "Superseded cutover archive manifest",
  );
  verifyLegacyArchive(oldPlan);
  const evidence = supersedeEvidencePaths(oldPlan, supersedePlan);
  requireExactPrivateBytes(
    evidence.plan,
    prettyJsonBytes(supersedePlan),
    "Cutover supersede plan artifact",
  );
  requireExactPrivateBytes(
    evidence.transaction,
    transactionBytes,
    "Cutover superseded transaction artifact",
  );
  return readSupersedeReceipt(oldPlan, supersedePlan);
}

function buildSupersedeReceipt(supersedePlan, authorization) {
  const authorizationFields = supersedeAuthorizationFields(
    supersedePlan,
    authorization,
  );
  return {
    schemaVersion: 1,
    kind: CUTOVER_SUPERSEDE_RECEIPT_KIND,
    policy: AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
    taskId: supersedePlan.taskId,
    stateRoot: supersedePlan.parameters.stateRoot,
    cutoverId: supersedePlan.parameters.cutoverId,
    supersedeId: supersedePlan.parameters.supersedeId,
    oldPlanDigest: supersedePlan.parameters.oldPlanDigest,
    transactionDigest: supersedePlan.parameters.transactionDigest,
    transactionPhase: supersedePlan.parameters.transactionPhase,
    claimGenerationsDigest: supersedePlan.parameters.claimGenerationsDigest,
    sourceSnapshotDigest: supersedePlan.parameters.sourceSnapshotDigest,
    archiveManifestDigest: supersedePlan.parameters.archiveManifestDigest,
    currentTaskDigest: supersedePlan.parameters.currentTaskDigest,
    intentDigest: supersedePlan.intentDigest,
    supersedePlanDigest: sha256(canonicalJsonBytes(supersedePlan)),
    ...authorizationFields,
    supersededAt: new Date().toISOString(),
  };
}

function requireCurrentSupersedeReceiptAuthorization(
  supersedePlan,
  receipt,
  authorize,
) {
  const currentAuthorization = authorize();
  const currentFields = supersedeAuthorizationFields(
    supersedePlan,
    currentAuthorization,
  );
  for (const key of [
    "confirmationBytesBase64",
    "confirmationDigest",
    "confirmationId",
    "confirmationPath",
    "confirmationRawDigest",
  ]) {
    if (currentFields[key] !== receipt[key]) {
      fail(
        "cutover_authorization_invalid",
        "The supersede receipt authorization changed before publication.",
      );
    }
  }
  return currentAuthorization;
}

function requireSupersedeCurrentTask(oldPlan, supersedePlan) {
  const currentTask = currentCanonicalTask(oldPlan);
  if (
    stableJson(currentTask) !== stableJson(supersedePlan.currentTask) ||
    sha256(canonicalJsonBytes(currentTask)) !==
      supersedePlan.parameters.currentTaskDigest
  ) {
    fail(
      "cutover_supersede_source_drift",
      "Canonical task changed after cutover supersede planning.",
    );
  }
}

export function applyAutomationKernelGuardCutoverSupersede({
  plan: rawOldPlan,
  supersedePlan: rawSupersedePlan,
  ownerConfirmationFile,
  checkpoint = () => undefined,
}) {
  const oldPlan = normalizePlan(rawOldPlan);
  const supersedePlan = normalizeSupersedePlan(rawSupersedePlan, oldPlan);
  requireLocalFilesystem(oldPlan.parameters.stateRoot, {
    plan: oldPlan,
    supersedePlan,
  });
  const authorize = () =>
    validateCurrentTaskOwnerConfirmation({
      confirmationFile: ownerConfirmationFile,
      taskId: supersedePlan.taskId,
      intentDigest: supersedePlan.intentDigest,
      nowMs: Date.now(),
    });
  authorize();
  requireSupersedeCurrentTask(oldPlan, supersedePlan);
  const preBootstrapTransactionRecord = exactTransactionRecord(oldPlan);
  const preBootstrapWriteAhead = readWriteAheadRecord(
    oldPlan,
    supersedePlan,
  );
  requireSupersedeWriteAheadScope(preBootstrapWriteAhead);
  requireLocalFilesystem(oldPlan.parameters.stateRoot, {
    plan: oldPlan,
    supersedePlan,
    transaction: preBootstrapTransactionRecord?.transaction,
    extraPaths: writeAheadFilesystemPaths(preBootstrapWriteAhead),
  });
  requireQuiescence(oldPlan);
  const bootstrapLock = prepareBootstrapLock(oldPlan, authorize);
  return withKernelFileGuard(
    bootstrapLock,
    () => {
      requireQuiescence(oldPlan);
      const authorization = authorize();
      const authorizedCheckpoint = (name, details) => {
        checkpoint(name, details);
        authorize();
      };
      requireSupersedeWriteAheadScope(
        readWriteAheadRecord(oldPlan, supersedePlan),
      );
      requireSupersedeStillPreMarker(oldPlan);
      requireSupersedeCurrentTask(oldPlan, supersedePlan);
      const paths = automationKernelGuardCutoverPaths(
        oldPlan.parameters.stateRoot,
      );
      recoverPendingWriteAhead(oldPlan, {
        supersedePlan,
        checkpoint: authorizedCheckpoint,
        beforeMutation: authorize,
      });
      let transactionRecord = exactTransactionRecord(oldPlan);
      requireLocalFilesystem(oldPlan.parameters.stateRoot, {
        plan: oldPlan,
        supersedePlan,
        transaction: transactionRecord?.transaction,
      });
      const evidence = supersedeEvidencePaths(oldPlan, supersedePlan);
      if (transactionRecord === null) {
        if (!existsSync(evidence.transaction)) {
          fail(
            "cutover_supersede_conflict",
            "No canonical or preserved transaction can complete supersession.",
          );
        }
        const archivedTransactionBytes = readPrivateMode600File(
          evidence.transaction,
          1024 * 1024,
        );
        if (
          sha256(archivedTransactionBytes) !==
          supersedePlan.parameters.transactionDigest
        ) {
          fail(
            "cutover_supersede_conflict",
            "Preserved superseded transaction conflicts.",
          );
        }
        const receipt = verifySupersedeEvidence(
          oldPlan,
          supersedePlan,
          archivedTransactionBytes,
        );
        if (receipt === null) {
          fail(
            "cutover_supersede_conflict",
            "Retired cutover transaction has no supersede receipt.",
          );
        }
        requireSnapshotMatch(
          sourceEntry(oldPlan, paths.writerLock),
          paths.writerLock,
          "Superseded outcome writer source",
        );
        requireSnapshotMatch(
          sourceEntry(oldPlan, paths.guardsRoot),
          paths.guardsRoot,
          "Superseded guard root source",
        );
        return {
          changed: false,
          action: CUTOVER_SUPERSEDE_ACTION,
          taskId: supersedePlan.taskId,
          intentDigest: supersedePlan.intentDigest,
          receipt,
        };
      }
      if (
        transactionRecord.transaction.phase !==
          supersedePlan.parameters.transactionPhase ||
        !["prepared", "claims-installed"].includes(
          transactionRecord.transaction.phase,
        ) ||
        sha256(transactionRecord.bytes) !==
          supersedePlan.parameters.transactionDigest ||
        sha256(
          canonicalJsonBytes(transactionRecord.transaction.claimGenerations),
        ) !== supersedePlan.parameters.claimGenerationsDigest
      ) {
        fail(
          "cutover_supersede_conflict",
          "Canonical cutover transaction changed after supersede planning.",
        );
      }

      writeSupersedePreparedEvidence(
        oldPlan,
        supersedePlan,
        transactionRecord.bytes,
        authorize,
      );
      authorizedCheckpoint("supersede-evidence-durable", {
        supersedeId: supersedePlan.parameters.supersedeId,
      });
      requireSupersedeStillPreMarker(oldPlan);
      restoreCutoverClaims(
        oldPlan,
        transactionRecord.transaction,
        supersedePlan,
        authorizedCheckpoint,
        authorize,
      );
      authorizedCheckpoint("supersede-claims-restored", {
        supersedeId: supersedePlan.parameters.supersedeId,
      });
      requireQuiescence(oldPlan);
      requireSupersedeStillPreMarker(oldPlan);
      requireSupersedeCurrentTask(oldPlan, supersedePlan);
      const finalAuthorization = authorize();
      requireLocalFilesystem(oldPlan.parameters.stateRoot, {
        plan: oldPlan,
        supersedePlan,
        transaction: transactionRecord.transaction,
      });
      const requireProtectedSupersedeState = ({
        canonicalTransactionRequired,
        receiptRequired,
      }) => {
        authorize();
        requireQuiescence(oldPlan);
        requireSupersedeStillPreMarker(oldPlan);
        requireSupersedeCurrentTask(oldPlan, supersedePlan);
        requireLocalFilesystem(oldPlan.parameters.stateRoot, {
          plan: oldPlan,
          supersedePlan,
          transaction: transactionRecord.transaction,
        });
        if (canonicalTransactionRequired) {
          const currentTransaction = exactTransactionRecord(oldPlan);
          if (
            currentTransaction === null ||
            !currentTransaction.bytes.equals(transactionRecord.bytes)
          ) {
            fail(
              "cutover_supersede_conflict",
              "Canonical cutover transaction changed before supersede retirement.",
            );
          }
        }
        const currentReceipt = verifySupersedeEvidence(
          oldPlan,
          supersedePlan,
          transactionRecord.bytes,
        );
        if (receiptRequired && currentReceipt === null) {
          fail(
            "cutover_supersede_conflict",
            "Durable supersede receipt is missing before transaction retirement.",
          );
        }
        authorize();
        return currentReceipt;
      };
      let receipt = readSupersedeReceipt(oldPlan, supersedePlan);
      if (receipt === null) {
        receipt = buildSupersedeReceipt(
          supersedePlan,
          finalAuthorization ?? authorization,
        );
      }
      validateSupersedeReceipt(receipt, supersedePlan);
      const receiptWasPublished = existsSync(evidence.receipt);
      const requireReceiptPublicationState = () => {
        requireProtectedSupersedeState({
          canonicalTransactionRequired: true,
          receiptRequired: existsSync(evidence.receipt),
        });
        if (!receiptWasPublished) {
          requireCurrentSupersedeReceiptAuthorization(
            supersedePlan,
            receipt,
            authorize,
          );
        }
      };
      writeImmutable(evidence.receipt, prettyJsonBytes(receipt), {
        checkpoint(name, details) {
          checkpoint(name, details);
          requireReceiptPublicationState();
        },
        linkedCheckpointName: "supersede-receipt-linked",
        beforeMutation: receiptWasPublished
          ? () =>
              requireProtectedSupersedeState({
                canonicalTransactionRequired: true,
                receiptRequired: true,
              })
          : requireReceiptPublicationState,
        beforeFinalize: requireReceiptPublicationState,
      });
      validateSupersedeReceipt(receipt, supersedePlan);
      checkpoint("supersede-receipt-durable", {
        supersedeId: supersedePlan.parameters.supersedeId,
      });
      requireProtectedSupersedeState({
        canonicalTransactionRequired: true,
        receiptRequired: true,
      });
      const requireRetirementState = () =>
        requireProtectedSupersedeState({
          canonicalTransactionRequired: false,
          receiptRequired: true,
        });
      removePathRecoverably(
        oldPlan,
        paths.transaction,
        snapshotPath(paths.transaction),
        {
          operationName: "supersede-transaction-retire",
          supersedePlan,
          checkpoint(name, details) {
            checkpoint(name, details);
            requireRetirementState();
          },
          checkpointName: "supersede-transaction-retire",
          beforeMutation: requireRetirementState,
        },
      );
      checkpoint("supersede-transaction-retired", {
        supersedeId: supersedePlan.parameters.supersedeId,
      });
      requireRetirementState();
      verifySupersedeEvidence(oldPlan, supersedePlan, transactionRecord.bytes);
      return {
        changed: true,
        action: CUTOVER_SUPERSEDE_ACTION,
        taskId: supersedePlan.taskId,
        intentDigest: supersedePlan.intentDigest,
        receipt,
      };
    },
    { label: "kernel guard cutover supersede", timeoutMs: 15_000 },
  );
}

export function applyAutomationKernelGuardCutover({
  plan: rawPlan,
  ownerConfirmationFile,
  checkpoint = () => undefined,
}) {
  const plan = normalizePlan(rawPlan);
  requireLocalFilesystem(plan.parameters.stateRoot, { plan });
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const authorize = () =>
    validateCurrentTaskOwnerConfirmation({
      confirmationFile: ownerConfirmationFile,
      taskId: plan.taskId,
      intentDigest: plan.intentDigest,
      nowMs: Date.now(),
    });
  const preexistingTransaction = readTransaction(plan, () => undefined, {
    allowIncompleteAuthorizationEvidence: true,
  });
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    transaction: preexistingTransaction,
  });
  const initialInspection = inspectAutomationKernelGuardCutover(
    plan.parameters.stateRoot,
  );
  if (initialInspection.ready) {
    if (preexistingTransaction?.phase !== "receipt-prepared") {
      fail(
        "cutover_transaction_invalid",
        "Active kernel guard cutover has no exact prepared transaction.",
      );
    }
    verifyPreparedArtifacts(plan, preexistingTransaction);
    return {
      changed: false,
      action: CUTOVER_ACTION,
      taskId: plan.taskId,
      intentDigest: plan.intentDigest,
      receipt: initialInspection.receipt,
    };
  }
  if (preexistingTransaction?.phase === "receipt-prepared") {
    if (!exactMarkerFile(paths.bootstrapLock)) {
      fail(
        "cutover_conflict",
        "Terminal cutover recovery has no exact bootstrap marker.",
      );
    }
    return withKernelFileGuard(
      paths.bootstrapLock,
      () => {
        requireQuiescence(plan);
        const transaction = readTransaction(plan, checkpoint);
        if (transaction?.phase !== "receipt-prepared") {
          fail(
            "cutover_transaction_invalid",
            "Terminal cutover recovery transaction changed while waiting.",
          );
        }
        const receipt = finishReceiptPreparedCutover(
          plan,
          transaction,
          checkpoint,
        );
        return {
          changed: true,
          action: CUTOVER_ACTION,
          taskId: plan.taskId,
          intentDigest: plan.intentDigest,
          receipt,
        };
      },
      { label: "kernel guard cutover activation", timeoutMs: 15_000 },
    );
  }
  const preBootstrapAuthorization = authorize();
  const preBootstrapAuthorizationSource = transactionAuthorizationRecord(
    plan,
    preBootstrapAuthorization,
  );
  const reauthorizeExact = () => {
    const currentAuthorization = authorize();
    const currentSource = transactionAuthorizationRecord(
      plan,
      currentAuthorization,
    );
    if (
      !sameTransactionAuthorizationSource(
        currentSource,
        preBootstrapAuthorizationSource,
      )
    ) {
      fail(
        "cutover_authorization_invalid",
        "Owner confirmation changed during kernel guard cutover.",
      );
    }
    return currentAuthorization;
  };
  const authorizedCheckpoint = (name, details) => {
    checkpoint(name, details);
    reauthorizeExact();
  };
  const preBootstrapWriteAhead = readWriteAheadRecord(plan);
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    transaction: preexistingTransaction,
    extraPaths: [
      ...transactionAuthorizationFilesystemPaths(
        preBootstrapAuthorizationSource,
      ),
      ...writeAheadFilesystemPaths(preBootstrapWriteAhead),
    ],
  });
  requireImmutableTargetPreflight(
    preBootstrapAuthorizationSource.confirmationArtifact,
    Buffer.from(
      preBootstrapAuthorizationSource.confirmationBytesBase64,
      "base64",
    ),
  );
  requireQuiescence(plan);
  if (preexistingTransaction === null) {
    validateUnmigratedSource(plan);
  } else {
    validateStaticSource(plan);
  }
  const bootstrapLock = prepareBootstrapLock(plan, reauthorizeExact);
  return withKernelFileGuard(
    bootstrapLock,
    () => {
      requireQuiescence(plan);
      const authorization = reauthorizeExact();
      let transaction = readTransaction(plan, authorizedCheckpoint, {
        allowIncompleteAuthorizationEvidence: true,
      });
      if (
        transaction === null &&
        existsSync(preparedAuthorizationArtifactPath(plan))
      ) {
        validateUnmigratedSource(plan);
        transaction = recoverPreparedAuthorizationTransaction(
          plan,
          authorizedCheckpoint,
          reauthorizeExact,
        );
      }
      if (transaction !== null && transaction.phase !== "receipt-prepared") {
        validateStaticSource(plan);
        transaction = repairTransactionAuthorizationEvidence(
          plan,
          transaction,
          authorizedCheckpoint,
          reauthorizeExact,
        );
      }
      if (transaction?.phase === "receipt-prepared") {
        const receipt = finishReceiptPreparedCutover(
          plan,
          transaction,
          checkpoint,
        );
        return {
          changed: true,
          action: CUTOVER_ACTION,
          taskId: plan.taskId,
          intentDigest: plan.intentDigest,
          receipt,
        };
      }
      if (transaction !== null) {
        requireLocalFilesystem(plan.parameters.stateRoot, {
          plan,
          transaction,
        });
        recoverPendingWriteAhead(plan, {
          checkpoint: authorizedCheckpoint,
          beforeMutation: reauthorizeExact,
        });
      }
      if (transaction === null) {
        validateUnmigratedSource(plan);
        reauthorizeExact();
        const initialAuthorization = transactionAuthorizationRecord(
          plan,
          authorization,
        );
        if (
          !sameTransactionAuthorizationSource(
            initialAuthorization,
            preBootstrapAuthorizationSource,
          )
        ) {
          fail(
            "cutover_authorization_invalid",
            "Validated owner confirmation changed after filesystem admission.",
          );
        }
        transaction = {
          schemaVersion: 1,
          kind: CUTOVER_TRANSACTION_KIND,
          cutoverId: plan.parameters.cutoverId,
          planDigest: sha256(canonicalJsonBytes(plan)),
          phase: "prepared",
          preparedAt: initialAuthorization.validatedAt,
          authorizations: [initialAuthorization],
          claimGenerations: [],
        };
        writeTransaction(plan, transaction, reauthorizeExact);
        authorizedCheckpoint("initial-authorization-transaction-durable", {
          confirmationId: initialAuthorization.confirmationId,
        });
        writeAuthorizationEvidence(
          plan,
          initialAuthorization,
          reauthorizeExact,
          authorizedCheckpoint,
          "initial-authorization-evidence-linked",
        );
        authorizedCheckpoint("initial-authorization-evidence-durable", {
          confirmationId: initialAuthorization.confirmationId,
          filePath: initialAuthorization.confirmationArtifact,
        });
        writePreparedAuthorizationEvidence(
          plan,
          initialAuthorization,
          reauthorizeExact,
          authorizedCheckpoint,
          "prepared-authorization-linked",
        );
        authorizedCheckpoint("prepared-authorization-durable", {
          confirmationId: initialAuthorization.confirmationId,
          filePath: preparedAuthorizationArtifactPath(plan),
        });
        authorizedCheckpoint("transaction-prepared-durable", {
          cutoverId: plan.parameters.cutoverId,
        });
      } else {
        validateStaticSource(plan);
        transaction = recordTransactionAuthorization(
          plan,
          transaction,
          authorization,
          preBootstrapAuthorizationSource,
          authorizedCheckpoint,
          reauthorizeExact,
        );
      }

      requireLocalFilesystem(plan.parameters.stateRoot, {
        plan,
        transaction,
      });

      const directory = artifactDirectory(plan);
      ensurePrivateDirectory(directory, reauthorizeExact);
      writeImmutable(path.join(directory, "plan.json"), prettyJsonBytes(plan), {
        beforeMutation: reauthorizeExact,
      });
      authorizedCheckpoint("plan-artifact-durable", {
        filePath: path.join(directory, "plan.json"),
      });
      writeImmutable(
        path.join(directory, "source-snapshot.json"),
        canonicalJsonBytes(plan.sourceSnapshot),
        { beforeMutation: reauthorizeExact },
      );
      authorizedCheckpoint("source-artifact-durable", {
        filePath: path.join(directory, "source-snapshot.json"),
      });
      writeImmutable(
        path.join(directory, "legacy-locks.json"),
        canonicalJsonBytes(legacyManifest(plan)),
        { beforeMutation: reauthorizeExact },
      );
      authorizedCheckpoint("legacy-manifest-artifact-durable", {
        filePath: path.join(directory, "legacy-locks.json"),
      });

      archiveLegacySources(plan, reauthorizeExact);
      verifyLegacyArchive(plan);
      authorizedCheckpoint("legacy-archive-durable", {
        directory: path.join(directory, "legacy-paths"),
      });
      if (
        transaction.phase === "prepared" ||
        transaction.phase === "claims-installed"
      ) {
        let generation;
        ({ transaction, generation } = currentClaimGeneration(
          plan,
          transaction,
          reauthorizeExact,
        ));
        installCutoverClaims(
          plan,
          transaction,
          generation,
          authorizedCheckpoint,
          reauthorizeExact,
        );
        authorizedCheckpoint("claims-before-proof", {
          claimToken: generation.claimToken,
        });
        requireQuiescence(plan);
        validateCutoverClaims(plan, transaction, generation);
        verifyLegacyArchive(plan);
        validateStaticSource(plan);
        if (transaction.phase === "prepared") {
          transaction = { ...transaction, phase: "claims-installed" };
          writeTransaction(plan, transaction, reauthorizeExact);
        }
        authorizedCheckpoint("claims-transaction-durable", {
          claimToken: generation.claimToken,
        });
        requireQuiescence(plan);
        validateCutoverClaims(plan, transaction, generation);
        verifyLegacyArchive(plan);
        validateStaticSource(plan);
        installPermanentTargets(
          plan,
          transaction,
          generation,
          authorizedCheckpoint,
          reauthorizeExact,
        );
        transaction = { ...transaction, phase: "markers-installed" };
        writeTransaction(plan, transaction, reauthorizeExact);
        authorizedCheckpoint("markers-transaction-durable", {
          cutoverId: plan.parameters.cutoverId,
        });
      }

      const latestGeneration = transaction.claimGenerations.at(-1);
      if (latestGeneration === undefined) {
        fail(
          "cutover_transaction_invalid",
          "Kernel guard cutover has no durable claim generation.",
        );
      }
      installPermanentTargets(
        plan,
        transaction,
        latestGeneration,
        authorizedCheckpoint,
        reauthorizeExact,
      );
      verifyLegacyArchive(plan);
      validateStaticSource(plan);

      if (transaction.phase === "markers-installed") {
        const finalAuthorization = reauthorizeExact();
        transaction = recordTransactionAuthorization(
          plan,
          transaction,
          finalAuthorization,
          preBootstrapAuthorizationSource,
          authorizedCheckpoint,
          reauthorizeExact,
        );
        const finalAuthorizationSource = transaction.authorizations.at(-1);
        if (
          !sameTransactionAuthorizationSource(
            transactionAuthorizationRecord(plan, reauthorizeExact()),
            finalAuthorizationSource,
          )
        ) {
          fail(
            "cutover_authorization_invalid",
            "Final cutover authorization does not match the durable transaction.",
          );
        }
        transaction = {
          ...transaction,
          phase: "receipt-prepared",
          completedAt: finalAuthorizationSource.validatedAt,
        };
        writeTransaction(plan, transaction, reauthorizeExact);
        checkpoint("receipt-transaction-durable", {
          cutoverId: plan.parameters.cutoverId,
        });
      }
      const receipt = finishReceiptPreparedCutover(
        plan,
        transaction,
        checkpoint,
      );
      return {
        changed: true,
        action: CUTOVER_ACTION,
        taskId: plan.taskId,
        intentDigest: plan.intentDigest,
        receipt,
      };
    },
    { label: "kernel guard cutover", timeoutMs: 15_000 },
  );
}

export function readAutomationKernelGuardCutoverPlan(planFile) {
  return normalizePlan(readPrivatePlanJson(planFile, "Cutover plan"));
}

function readPrivatePlanJson(planFile, label) {
  if (!path.isAbsolute(planFile) || path.resolve(planFile) !== planFile) {
    fail(
      "cutover_plan_invalid",
      `${label} path must be absolute and canonical.`,
    );
  }
  return JSON.parse(
    fatalDecoder.decode(
      readPrivateMode600File(
        planFile,
        AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES,
      ),
    ),
  );
}

export function readAutomationKernelGuardCutoverSupersedePlan(
  supersedePlanFile,
  oldPlan,
) {
  return normalizeSupersedePlan(
    readPrivatePlanJson(supersedePlanFile, "Cutover supersede plan"),
    normalizePlan(oldPlan),
  );
}

export function writeAutomationKernelGuardCutoverSupersedePlan(
  supersedePlanFile,
  supersedePlan,
  oldPlan,
) {
  if (!path.isAbsolute(supersedePlanFile)) {
    fail(
      "cutover_plan_invalid",
      "Cutover supersede plan path must be absolute.",
    );
  }
  if (existsSync(supersedePlanFile)) {
    fail("cutover_plan_invalid", "Cutover supersede plan file already exists.");
  }
  const normalized = normalizeSupersedePlan(
    supersedePlan,
    normalizePlan(oldPlan),
  );
  writeImmutable(
    supersedePlanFile,
    assertAutomationKernelGuardCutoverPlanSize(prettyJsonBytes(normalized)),
  );
  return supersedePlanFile;
}

export function writeAutomationKernelGuardCutoverPlan(planFile, plan) {
  if (!path.isAbsolute(planFile)) {
    fail("cutover_plan_invalid", "Cutover plan path must be absolute.");
  }
  if (existsSync(planFile)) {
    fail("cutover_plan_invalid", "Cutover plan file already exists.");
  }
  const normalized = normalizePlan(plan);
  writeImmutable(
    planFile,
    assertAutomationKernelGuardCutoverPlanSize(prettyJsonBytes(normalized)),
  );
  return planFile;
}
