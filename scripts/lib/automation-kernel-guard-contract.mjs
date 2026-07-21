import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  readdirSync,
  statfsSync,
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

export const AUTOMATION_KERNEL_GUARD_PROTOCOL = "freed-kernel-file-lock-v1";
export const AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY =
  "freed-kernel-guard-cutover-v1";
export const AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES = 32 * 1024 * 1024;
export const AUTOMATION_KERNEL_GUARD_OWNER_FILE = "owner.json";
export const AUTOMATION_KERNEL_GUARD_INNER_FILE = "kernel.lock";
export const AUTOMATION_KERNEL_GUARD_NAMES = Object.freeze([
  "tasks",
  "events",
  "lease-runtime-observer",
  "lease-stability-controller",
  "lease-scaffolding-writer",
  "lease-pr-publisher",
  "lease-nightly-writer",
  "lease-release-verifier",
  "lease-owner-governance",
]);

export const AUTOMATION_KERNEL_GUARD_MARKER = Object.freeze({
  schemaVersion: 1,
  pid: 1,
  processStartIdentity: null,
  lockProtocol: AUTOMATION_KERNEL_GUARD_PROTOCOL,
});
const AUTOMATION_KERNEL_GUARD_MARKER_TEXT = `${JSON.stringify(AUTOMATION_KERNEL_GUARD_MARKER)}\n`;
export function automationKernelGuardMarkerBytes() {
  return Buffer.from(AUTOMATION_KERNEL_GUARD_MARKER_TEXT, "utf8");
}
export const AUTOMATION_KERNEL_GUARD_MARKER_DIGEST = createHash("sha256")
  .update(AUTOMATION_KERNEL_GUARD_MARKER_TEXT, "utf8")
  .digest("hex");

const MAX_CUTOVER_JSON_BYTES = 64 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CUTOVER_ACTION = "automation-guard.cutover";
const CUTOVER_PLAN_KIND = "automation-kernel-guard-cutover-plan";
const CUTOVER_TRANSACTION_KIND = "automation-kernel-guard-cutover-transaction";
const CUTOVER_ACTOR_IDS = Object.freeze([
  "freed-runtime-observer",
  "freed-stability-controller",
  "freed-scaffolding-maintainer",
  "freed-nightly-runner",
  "freed-release-verifier",
]);
const CUTOVER_TASK_STATES = Object.freeze([
  "observed",
  "triaged",
  "approved_for_pr",
  "implemented",
  "validated",
  "merged",
  "installed",
  "soaking",
  "verified_effective",
  "verified_neutral",
  "regressed",
  "inconclusive",
  "governance_blocked",
  "superseded",
  "implementation_failed",
  "closed",
]);
const CUTOVER_OUTCOME_TASK_STATES = new Set([
  "merged",
  "installed",
  "verified_effective",
  "verified_neutral",
  "regressed",
  "inconclusive",
  "governance_blocked",
  "superseded",
  "implementation_failed",
]);
const CUTOVER_OBSERVER_AUTHORITIES = Object.freeze([
  "observe-only",
  "plan-only",
  "pr-only",
  "merge-safe",
]);
const CUTOVER_PROVIDER_AUTHORITIES = Object.freeze([
  "forbidden",
  "approval-required",
  "approved",
]);
const CUTOVER_MAX_AUTHORIZATIONS = 64;
const fatalDecoder = new TextDecoder("utf-8", { fatal: true });
const LOCAL_FILESYSTEM_TYPES = Object.freeze([
  "apfs",
  "btrfs",
  "ext",
  "overlayfs",
  "tmpfs",
  "xfs",
]);
const FILESYSTEM_TYPE_NAMES = Object.freeze({
  darwin: Object.freeze({
    // APFS is the only supported macOS host filesystem for this contract.
    0x0000001a: "apfs",
  }),
  linux: Object.freeze({
    0x0000ef53: "ext",
    0x01021994: "tmpfs",
    0x58465342: "xfs",
    0x794c7630: "overlayfs",
    0x9123683e: "btrfs",
  }),
});
const RECEIPT_CORE_KEYS = Object.freeze(
  [
    "archiveManifestDigest",
    "completedAt",
    "confirmationDigest",
    "confirmationId",
    "cutoverId",
    "guardNames",
    "intentDigest",
    "markerDigest",
    "policy",
    "schemaVersion",
    "sourceSnapshotDigest",
    "stateRoot",
    "transactionDigest",
  ].sort(),
);
const GLOBAL_RECEIPT_KEYS = Object.freeze(
  [...RECEIPT_CORE_KEYS, "artifactReceipt", "artifactReceiptDigest"].sort(),
);
const CUTOVER_PLAN_KEYS = Object.freeze(
  [
    "action",
    "createdAt",
    "intent",
    "intentDigest",
    "kind",
    "parameters",
    "schemaVersion",
    "sourceSnapshot",
    "taskId",
  ].sort(),
);
const CUTOVER_PARAMETER_KEYS = Object.freeze(
  [
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
  ].sort(),
);
const CUTOVER_INTENT_KEYS = Object.freeze(
  ["action", "parameters", "schemaVersion", "taskId"].sort(),
);
const CUTOVER_SOURCE_KEYS = Object.freeze(
  [
    "actors",
    "codexHome",
    "entries",
    "repoRoot",
    "schemaVersion",
    "sourceCodeSha",
    "stateRoot",
  ].sort(),
);
const CUTOVER_ACTOR_RECORD_KEYS = Object.freeze(["digest", "path"].sort());
const CUTOVER_TRANSACTION_AUTHORIZATION_KEYS = Object.freeze(
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
const CUTOVER_CLAIM_GENERATION_KEYS = Object.freeze(
  ["claimedAt", "claimToken", "pid", "processStartIdentity"].sort(),
);

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

function automationKernelGuardSnapshotNativeDigestValue(
  entry,
  includeName = false,
) {
  const result = { kind: entry.kind, mode: entry.mode };
  if (includeName) result.name = path.basename(entry.path);
  if (entry.kind === "file") {
    result.size = entry.size;
    result.digest = entry.digest;
  } else if (entry.kind === "directory") {
    result.entries = entry.entries.map((child) =>
      automationKernelGuardSnapshotNativeDigestValue(child, true),
    );
  }
  return result;
}

export function automationKernelGuardSnapshotNativeTreeDigest(entry) {
  return sha256(
    canonicalJsonBytes(
      automationKernelGuardSnapshotNativeDigestValue(entry),
    ),
  );
}

function prettyJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sameKeys(record, expected) {
  return (
    record !== null &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    Object.keys(record).sort().join("\n") === expected.join("\n")
  );
}

function unsignedFilesystemType(value) {
  if (typeof value === "bigint") {
    return Number(BigInt.asUintN(32, value));
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error("filesystem type is not an exact integer");
  }
  return value >>> 0;
}

export function resolveAutomationKernelGuardFilesystemType(
  stateRoot,
  { platform = process.platform, statfs = statfsSync } = {},
) {
  const platformTypes = FILESYSTEM_TYPE_NAMES[platform];
  if (platformTypes === undefined) {
    throw new Error(`platform ${platform} has no local filesystem allowlist`);
  }
  const stats = statfs(path.resolve(stateRoot), { bigint: true });
  const type = unsignedFilesystemType(stats?.type);
  const filesystemType = platformTypes[type];
  if (filesystemType === undefined) {
    throw new Error(
      `filesystem type 0x${type.toString(16)} is not in the ${platform} local allowlist`,
    );
  }
  return filesystemType;
}

function nearestExistingPath(targetPath) {
  let current = path.resolve(targetPath);
  while (true) {
    try {
      lstatSync(current);
      return current;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current)
      throw new Error(`no existing ancestor for ${targetPath}`);
    current = parent;
  }
}

export function inspectAutomationKernelGuardFilesystemPaths(
  stateRoot,
  candidatePaths,
  { resolveFilesystemType = resolveAutomationKernelGuardFilesystemType } = {},
) {
  const canonicalStateRoot = path.resolve(stateRoot);
  const problems = [];
  const admittedPaths = new Set();
  for (const rawCandidatePath of candidatePaths) {
    const candidatePath = path.resolve(rawCandidatePath);
    const relative = path.relative(canonicalStateRoot, candidatePath);
    if (
      candidatePath !== canonicalStateRoot &&
      (relative === "" ||
        relative.startsWith("..") ||
        path.isAbsolute(relative))
    ) {
      problems.push(`${candidatePath} escapes the automation state root`);
      continue;
    }
    let currentPath = candidatePath;
    while (true) {
      admittedPaths.add(currentPath);
      if (currentPath === canonicalStateRoot) break;
      currentPath = path.dirname(currentPath);
    }
  }
  let baselineType;
  let baselineDevice;
  try {
    baselineType = resolveFilesystemType(canonicalStateRoot);
    if (!LOCAL_FILESYSTEM_TYPES.includes(baselineType)) {
      throw new Error(`unsupported filesystem type ${String(baselineType)}`);
    }
    baselineDevice = lstatSync(canonicalStateRoot).dev;
  } catch (error) {
    problems.push(
      `${canonicalStateRoot} filesystem type could not be admitted: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ready: false, problems, filesystemType: null, device: null };
  }
  for (const candidatePath of admittedPaths) {
    try {
      const physicalPath = nearestExistingPath(candidatePath);
      const filesystemType = resolveFilesystemType(physicalPath);
      const device = lstatSync(physicalPath).dev;
      if (
        !LOCAL_FILESYSTEM_TYPES.includes(filesystemType) ||
        filesystemType !== baselineType ||
        device !== baselineDevice
      ) {
        problems.push(
          `${candidatePath} is not on the admitted ${baselineType} automation state filesystem`,
        );
      }
    } catch (error) {
      problems.push(
        `${candidatePath} filesystem type could not be admitted: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    ready: problems.length === 0,
    problems,
    filesystemType: baselineType,
    device: baselineDevice,
  };
}

export function automationKernelGuardCutoverPaths(stateRoot) {
  const resolvedStateRoot = path.resolve(stateRoot);
  const controlRoot = path.join(resolvedStateRoot, "control");
  const guardsRoot = path.join(controlRoot, ".guards");
  return {
    stateRoot: resolvedStateRoot,
    controlRoot,
    guardsRoot,
    globalReceipt: path.join(controlRoot, "kernel-guard-cutover.json"),
    transaction: path.join(
      controlRoot,
      "kernel-guard-cutover.transaction.json",
    ),
    writeAhead: path.join(controlRoot, "kernel-guard-cutover.write-ahead.json"),
    bootstrapLock: path.join(
      controlRoot,
      "kernel-guard-cutover.bootstrap.lock",
    ),
    writerLock: path.join(resolvedStateRoot, "outcomes.jsonl.writer-lock"),
    artifactRoot: path.join(
      resolvedStateRoot,
      "artifacts",
      "kernel-guard-cutover",
    ),
    guards: Object.fromEntries(
      AUTOMATION_KERNEL_GUARD_NAMES.map((name) => {
        const directory = path.join(guardsRoot, `${name}.lock`);
        return [
          name,
          {
            directory,
            owner: path.join(directory, AUTOMATION_KERNEL_GUARD_OWNER_FILE),
            inner: path.join(directory, AUTOMATION_KERNEL_GUARD_INNER_FILE),
          },
        ];
      }),
    ),
  };
}

function inspectPrivateDirectory(directoryPath, currentUid, problems) {
  let stats;
  try {
    stats = lstatSync(directoryPath);
  } catch (error) {
    problems.push(
      `${directoryPath} is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUid ||
    (stats.mode & 0o7777) !== 0o700
  ) {
    problems.push(
      `${directoryPath} must be a private physical mode 0700 directory owned by the current user`,
    );
    return false;
  }
  try {
    if (realpathSync(directoryPath) !== path.resolve(directoryPath)) {
      problems.push(`${directoryPath} is not canonical`);
      return false;
    }
  } catch (error) {
    problems.push(
      `${directoryPath} could not be resolved canonically: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
  return true;
}

function readPrivateFile(filePath, currentUid, problems, maxBytes) {
  let descriptor;
  try {
    if (
      typeof constants.O_NOFOLLOW !== "number" ||
      typeof constants.O_NONBLOCK !== "number"
    ) {
      throw new Error("safe no-follow file admission is unavailable");
    }
    const beforePath = lstatSync(filePath);
    if (
      !beforePath.isFile() ||
      beforePath.isSymbolicLink() ||
      beforePath.uid !== currentUid ||
      (beforePath.mode & 0o7777) !== 0o600 ||
      beforePath.nlink !== 1
    ) {
      throw new Error(
        "file must be a private physical mode 0600 single-link regular file owned by the current user",
      );
    }
    if (realpathSync(filePath) !== path.resolve(filePath)) {
      throw new Error("file path is not canonical");
    }
    descriptor = openSync(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== beforePath.dev ||
      opened.ino !== beforePath.ino ||
      opened.uid !== currentUid ||
      (opened.mode & 0o7777) !== 0o600 ||
      opened.nlink !== 1 ||
      opened.size < 0 ||
      opened.size > maxBytes
    ) {
      throw new Error("file changed or exceeds its exact admission boundary");
    }
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
    const afterPath = lstatSync(filePath);
    if (
      offset !== opened.size ||
      afterOpened.dev !== opened.dev ||
      afterOpened.ino !== opened.ino ||
      !afterOpened.isFile() ||
      afterOpened.uid !== currentUid ||
      (afterOpened.mode & 0o7777) !== 0o600 ||
      afterOpened.size !== opened.size ||
      afterOpened.nlink !== 1 ||
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      afterPath.dev !== opened.dev ||
      afterPath.ino !== opened.ino ||
      afterPath.uid !== currentUid ||
      (afterPath.mode & 0o7777) !== 0o600 ||
      afterPath.size !== opened.size ||
      afterPath.nlink !== 1 ||
      realpathSync(filePath) !== path.resolve(filePath)
    ) {
      throw new Error("file changed while it was read");
    }
    return bytes.subarray(0, offset);
  } catch (error) {
    problems.push(
      `${filePath} is not safely readable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readJsonFile(
  filePath,
  currentUid,
  problems,
  maxBytes = MAX_CUTOVER_JSON_BYTES,
) {
  const bytes = readPrivateFile(filePath, currentUid, problems, maxBytes);
  if (bytes === null) return null;
  try {
    return { bytes, value: JSON.parse(fatalDecoder.decode(bytes)) };
  } catch {
    problems.push(`${filePath} does not contain exact fatal UTF-8 JSON`);
    return null;
  }
}

function validReceiptCore(record, expectedStateRoot) {
  return (
    record !== null &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    record.schemaVersion === 1 &&
    record.policy === AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY &&
    SHA256_PATTERN.test(String(record.cutoverId ?? "")) &&
    record.stateRoot === expectedStateRoot &&
    record.markerDigest === AUTOMATION_KERNEL_GUARD_MARKER_DIGEST &&
    Array.isArray(record.guardNames) &&
    record.guardNames.join("\n") === AUTOMATION_KERNEL_GUARD_NAMES.join("\n") &&
    SHA256_PATTERN.test(String(record.sourceSnapshotDigest ?? "")) &&
    SHA256_PATTERN.test(String(record.archiveManifestDigest ?? "")) &&
    SHA256_PATTERN.test(String(record.transactionDigest ?? "")) &&
    SHA256_PATTERN.test(String(record.intentDigest ?? "")) &&
    IDENTIFIER_PATTERN.test(String(record.confirmationId ?? "")) &&
    SHA256_PATTERN.test(String(record.confirmationDigest ?? "")) &&
    isCanonicalTimestamp(record.completedAt)
  );
}

export function canonicalAutomationKernelGuardReceiptBytes(core) {
  if (
    !sameKeys(core, RECEIPT_CORE_KEYS) ||
    !validReceiptCore(core, core?.stateRoot)
  ) {
    throw new Error("Automation kernel guard cutover receipt core is invalid.");
  }
  const canonical = Object.fromEntries(
    RECEIPT_CORE_KEYS.map((key) => [key, core[key]]),
  );
  return Buffer.from(`${JSON.stringify(canonical, null, 2)}\n`, "utf8");
}

function exactGlobalReceiptBytes(receipt) {
  return prettyJsonBytes({
    schemaVersion: receipt.schemaVersion,
    policy: receipt.policy,
    cutoverId: receipt.cutoverId,
    stateRoot: receipt.stateRoot,
    markerDigest: receipt.markerDigest,
    guardNames: receipt.guardNames,
    sourceSnapshotDigest: receipt.sourceSnapshotDigest,
    archiveManifestDigest: receipt.archiveManifestDigest,
    transactionDigest: receipt.transactionDigest,
    intentDigest: receipt.intentDigest,
    confirmationId: receipt.confirmationId,
    confirmationDigest: receipt.confirmationDigest,
    completedAt: receipt.completedAt,
    artifactReceipt: receipt.artifactReceipt,
    artifactReceiptDigest: receipt.artifactReceiptDigest,
  });
}

function safeSnapshotBasename(entry, problems) {
  if (typeof entry?.path !== "string" || !path.isAbsolute(entry.path)) {
    problems.push("Cutover snapshot entry has no absolute source path");
    return null;
  }
  const name = path.basename(entry.path);
  if (name === "" || name === "." || name === "..") {
    problems.push(
      `Cutover snapshot entry has an unsafe basename: ${entry.path}`,
    );
    return null;
  }
  return name;
}

function isCanonicalTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isCanonicalAbsolutePath(value) {
  return (
    typeof value === "string" &&
    path.isAbsolute(value) &&
    path.resolve(value) === value
  );
}

function canonicalIntentDigest(intent) {
  return sha256(Buffer.from(stableJson(intent), "utf8"));
}

function expectedCutoverId(plan) {
  return sha256(
    canonicalJsonBytes({
      policy: AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
      taskId: plan.taskId,
      sourceSnapshotDigest: plan.parameters.sourceSnapshotDigest,
      archiveManifestDigest: plan.parameters.archiveManifestDigest,
      sourceCodeSha: plan.parameters.sourceCodeSha,
    }),
  );
}

function validateSnapshotEntry(
  entry,
  expectedPath,
  { requireBytes = true } = {},
  problems,
) {
  if (
    entry === null ||
    typeof entry !== "object" ||
    Array.isArray(entry) ||
    entry.path !== expectedPath ||
    !isCanonicalAbsolutePath(entry.path)
  ) {
    problems.push(`${expectedPath} has an invalid source snapshot entry`);
    return false;
  }
  if (entry.kind === "missing") {
    if (!sameKeys(entry, ["kind", "path"].sort())) {
      problems.push(`${expectedPath} has an invalid missing snapshot shape`);
      return false;
    }
    return true;
  }
  if (entry.kind === "file") {
    const fileKeys = ["digest", "kind", "mode", "path", "size"];
    if (requireBytes) fileKeys.push("bytesBase64");
    if (
      !sameKeys(entry, fileKeys.sort()) ||
      ![0o600, 0o640, 0o644].includes(entry.mode) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > 128 * 1024 * 1024 ||
      !SHA256_PATTERN.test(String(entry.digest ?? ""))
    ) {
      problems.push(`${expectedPath} has an invalid file snapshot shape`);
      return false;
    }
    if (!requireBytes) return true;
    if (typeof entry.bytesBase64 !== "string") {
      problems.push(`${expectedPath} has no exact embedded source bytes`);
      return false;
    }
    const bytes = Buffer.from(entry.bytesBase64, "base64");
    if (
      bytes.length !== entry.size ||
      bytes.toString("base64") !== entry.bytesBase64 ||
      sha256(bytes) !== entry.digest
    ) {
      problems.push(`${expectedPath} has noncanonical embedded source bytes`);
      return false;
    }
    return true;
  }
  if (
    entry.kind !== "directory" ||
    !sameKeys(
      entry,
      ["entries", "kind", "mode", "nativeTreeDigest", "path"].sort(),
    ) ||
    ![0o700, 0o755].includes(entry.mode) ||
    !Array.isArray(entry.entries) ||
    !SHA256_PATTERN.test(String(entry.nativeTreeDigest ?? ""))
  ) {
    problems.push(`${expectedPath} has an invalid directory snapshot shape`);
    return false;
  }
  const names = entry.entries.map((child) =>
    safeSnapshotBasename(child, problems),
  );
  if (
    names.some((name) => name === null) ||
    new Set(names).size !== names.length ||
    names.join("\n") !== [...names].sort().join("\n")
  ) {
    problems.push(`${expectedPath} has a noncanonical source occurrence order`);
    return false;
  }
  let valid = true;
  for (let index = 0; index < entry.entries.length; index += 1) {
    const child = entry.entries[index];
    valid =
      validateSnapshotEntry(
        child,
        path.join(expectedPath, names[index]),
        { requireBytes },
        problems,
      ) && valid;
  }
  if (
    valid &&
    automationKernelGuardSnapshotNativeTreeDigest(entry) !==
      entry.nativeTreeDigest
  ) {
    problems.push(`${expectedPath} has an invalid native tree digest`);
    valid = false;
  }
  return valid;
}

function normalizedStoredObserverAuthority(value) {
  return value === "release" ? "merge-safe" : value;
}

function normalizedInstalledBuildIdentity(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const version = String(value.version ?? "")
    .trim()
    .replace(/^v/i, "");
  const commitSha = String(value.commitSha ?? "")
    .trim()
    .toLowerCase();
  const channel = String(value.channel ?? "").trim();
  const artifactDigest = String(value.artifactDigest ?? "")
    .trim()
    .toLowerCase();
  if (
    version === "" ||
    !/^[0-9a-f]{40}$/.test(commitSha) ||
    !["dev", "production"].includes(channel) ||
    (artifactDigest !== "" && !SHA256_PATTERN.test(artifactDigest))
  ) {
    return null;
  }
  return {
    version,
    commitSha,
    channel,
    ...(artifactDigest === "" ? {} : { artifactDigest }),
  };
}

function canonicalTaskRecordIsValid(task) {
  if (task === null || typeof task !== "object" || Array.isArray(task)) {
    return false;
  }
  const details = task.details;
  if (
    details === null ||
    typeof details !== "object" ||
    Array.isArray(details)
  ) {
    return false;
  }
  const normalizedObserverAuthority = normalizedStoredObserverAuthority(
    task.observerAuthority,
  );
  const taskBehavioral = task.behavioral;
  const detailsBehavioral = details.behavioral;
  if (
    (taskBehavioral !== undefined && typeof taskBehavioral !== "boolean") ||
    (detailsBehavioral !== undefined &&
      typeof detailsBehavioral !== "boolean") ||
    (typeof taskBehavioral === "boolean" &&
      typeof detailsBehavioral === "boolean" &&
      taskBehavioral !== detailsBehavioral)
  ) {
    return false;
  }

  let installedIdentityValid = true;
  if (task.installedIdentity !== undefined) {
    const installedIdentity = normalizedInstalledBuildIdentity(
      task.installedIdentity,
    );
    installedIdentityValid =
      installedIdentity !== null &&
      JSON.stringify(installedIdentity) ===
        JSON.stringify(task.installedIdentity) &&
      (task.installedBuild === undefined ||
        task.installedBuild === installedIdentity.version);
  }
  const pendingOutcome = task.pendingOutcome;
  const latestOutcome = details.latestOutcome;

  return (
    task.schemaVersion === 1 &&
    typeof task.taskId === "string" &&
    IDENTIFIER_PATTERN.test(task.taskId) &&
    CUTOVER_TASK_STATES.includes(task.state) &&
    Number.isSafeInteger(task.revision) &&
    task.revision > 0 &&
    CUTOVER_OBSERVER_AUTHORITIES.includes(normalizedObserverAuthority) &&
    CUTOVER_PROVIDER_AUTHORITIES.includes(task.providerAuthority) &&
    (task.providerAuthority === "approved"
      ? typeof task.providerApprovalReference === "string" &&
        task.providerApprovalReference.trim() !== ""
      : task.providerApprovalReference === undefined) &&
    installedIdentityValid &&
    (task.installedBuild === undefined ||
      (typeof task.installedBuild === "string" &&
        task.installedBuild.trim() !== "")) &&
    (pendingOutcome === undefined ||
      (pendingOutcome !== null &&
        typeof pendingOutcome === "object" &&
        !Array.isArray(pendingOutcome) &&
        CUTOVER_OUTCOME_TASK_STATES.has(pendingOutcome.outcome) &&
        pendingOutcome.outcome === task.state &&
        SHA256_PATTERN.test(String(pendingOutcome.outcomeDigest ?? "")) &&
        pendingOutcome.outcomeDigest ===
          String(pendingOutcome.outcomeDigest).toLowerCase() &&
        Number.isSafeInteger(pendingOutcome.taskRevision) &&
        pendingOutcome.taskRevision === task.revision &&
        latestOutcome?.outcome === pendingOutcome.outcome &&
        SHA256_PATTERN.test(String(latestOutcome?.outcomeDigest ?? "")) &&
        String(latestOutcome.outcomeDigest).toLowerCase() ===
          pendingOutcome.outcomeDigest)) &&
    (task.mergedAt === undefined ||
      Number.isFinite(Date.parse(String(task.mergedAt)))) &&
    (task.installedAt === undefined ||
      Number.isFinite(Date.parse(String(task.installedAt)))) &&
    (task.soakStartedAt === undefined ||
      Number.isFinite(Date.parse(String(task.soakStartedAt))))
  );
}

function validateCanonicalTaskSource(entry, taskId, problems) {
  if (entry?.kind !== "file" || typeof entry.bytesBase64 !== "string") {
    problems.push(
      "Cutover source does not contain the canonical task manifest",
    );
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(
      fatalDecoder.decode(Buffer.from(entry.bytesBase64, "base64")),
    );
  } catch {
    problems.push("Cutover canonical task manifest is malformed");
    return;
  }
  if (
    manifest?.schemaVersion !== 1 ||
    !Number.isSafeInteger(manifest?.revision) ||
    manifest.revision < 0 ||
    !Array.isArray(manifest?.tasks)
  ) {
    problems.push("Cutover canonical task manifest has an unsupported shape");
    return;
  }
  const taskIds = new Set();
  let matchingTaskFound = false;
  for (const task of manifest.tasks) {
    if (!canonicalTaskRecordIsValid(task)) {
      problems.push(
        "Cutover canonical task manifest contains an unsupported task record",
      );
      return;
    }
    if (taskIds.has(task.taskId)) {
      problems.push(
        `Cutover canonical task manifest contains duplicate task ${task.taskId}`,
      );
      return;
    }
    taskIds.add(task.taskId);
    if (task.taskId === taskId) matchingTaskFound = true;
  }
  if (!matchingTaskFound) {
    problems.push(
      `Canonical task ${taskId} does not exist in the cutover source`,
    );
  }
}

export function inspectAutomationKernelGuardCanonicalTaskSource(
  entry,
  taskId,
) {
  const problems = [];
  validateCanonicalTaskSource(entry, taskId, problems);
  return {
    ready: problems.length === 0,
    problems,
  };
}

function validateSourceSnapshot(plan, paths, problems) {
  const source = plan?.sourceSnapshot;
  if (
    !sameKeys(source, CUTOVER_SOURCE_KEYS) ||
    source.schemaVersion !== 1 ||
    source.stateRoot !== plan.parameters.stateRoot ||
    source.codexHome !== plan.parameters.codexHome ||
    source.repoRoot !== plan.parameters.repoRoot ||
    source.sourceCodeSha !== plan.parameters.sourceCodeSha ||
    !isCanonicalAbsolutePath(source.stateRoot) ||
    !isCanonicalAbsolutePath(source.codexHome) ||
    !isCanonicalAbsolutePath(source.repoRoot) ||
    !GIT_OBJECT_ID_PATTERN.test(String(source.sourceCodeSha ?? "")) ||
    source.actors === null ||
    typeof source.actors !== "object" ||
    Array.isArray(source.actors) ||
    !Array.isArray(source.entries)
  ) {
    problems.push(
      "Cutover source snapshot has an unsupported production shape",
    );
    return null;
  }
  if (
    Object.keys(source.actors).sort().join("\n") !==
    [...CUTOVER_ACTOR_IDS].sort().join("\n")
  ) {
    problems.push(
      "Cutover source snapshot does not bind all five saved actors",
    );
  }
  const expectedTopLevelPaths = [
    path.join(paths.controlRoot, "current-tasks.json"),
    path.join(paths.controlRoot, "events.jsonl"),
    path.join(paths.stateRoot, "outcomes.jsonl"),
    path.join(paths.controlRoot, "leases"),
    paths.guardsRoot,
    paths.writerLock,
    ...CUTOVER_ACTOR_IDS.map((actor) =>
      path.join(source.codexHome, "automations", actor, "automation.toml"),
    ),
  ];
  if (
    source.entries.length !== expectedTopLevelPaths.length ||
    source.entries.map((entry) => entry?.path).join("\n") !==
      expectedTopLevelPaths.join("\n")
  ) {
    problems.push(
      "Cutover source snapshot does not contain the exact production source set",
    );
    return null;
  }
  for (let index = 0; index < source.entries.length; index += 1) {
    const expectedPath = expectedTopLevelPaths[index];
    const digestOnly =
      expectedPath === path.join(paths.controlRoot, "events.jsonl") ||
      expectedPath === path.join(paths.stateRoot, "outcomes.jsonl");
    validateSnapshotEntry(
      source.entries[index],
      expectedPath,
      { requireBytes: !digestOnly },
      problems,
    );
  }
  const entriesByPath = new Map(
    source.entries.map((entry) => [entry?.path, entry]),
  );
  const writerEntry = entriesByPath.get(paths.writerLock);
  const guardsEntry = entriesByPath.get(paths.guardsRoot);
  const canonicalGuardNames = new Set(
    AUTOMATION_KERNEL_GUARD_NAMES.map((name) => `${name}.lock`),
  );
  if (!writerEntry || !["file", "missing"].includes(writerEntry.kind)) {
    problems.push("Cutover source writer has an unsupported legacy shape");
  }
  if (
    guardsEntry?.kind !== "directory" ||
    guardsEntry.entries.some((entry) => {
      const name = path.basename(String(entry?.path ?? ""));
      return (
        entry?.kind !== "directory" ||
        ![...canonicalGuardNames].some(
          (canonicalName) =>
            name === canonicalName ||
            name.startsWith(`${canonicalName}.abandoned.`),
        )
      );
    })
  ) {
    problems.push("Cutover source guard root has an unsupported legacy shape");
  }
  validateCanonicalTaskSource(
    entriesByPath.get(path.join(paths.controlRoot, "current-tasks.json")),
    plan.taskId,
    problems,
  );
  for (const actor of CUTOVER_ACTOR_IDS) {
    const expectedPath = path.join(
      source.codexHome,
      "automations",
      actor,
      "automation.toml",
    );
    const actorRecord = source.actors[actor];
    const actorEntry = entriesByPath.get(expectedPath);
    if (
      !sameKeys(actorRecord, CUTOVER_ACTOR_RECORD_KEYS) ||
      actorRecord.path !== expectedPath ||
      !SHA256_PATTERN.test(String(actorRecord.digest ?? "")) ||
      actorEntry?.kind !== "file" ||
      actorEntry.digest !== actorRecord.digest ||
      typeof actorEntry.bytesBase64 !== "string"
    ) {
      problems.push(`Cutover source actor ${actor} is not cross-bound exactly`);
      continue;
    }
    let actorText;
    try {
      actorText = fatalDecoder.decode(
        Buffer.from(actorEntry.bytesBase64, "base64"),
      );
    } catch {
      problems.push(`Cutover source actor ${actor} is not fatal UTF-8`);
      continue;
    }
    const statuses = [...actorText.matchAll(/^status\s*=\s*"([^"]+)"\s*$/gm)];
    if (statuses.length !== 1 || statuses[0][1] !== "PAUSED") {
      problems.push(`Cutover source actor ${actor} was not exactly PAUSED`);
    }
  }
  return {
    source,
    entriesByPath,
    legacyManifest: {
      schemaVersion: 1,
      entries: source.entries.filter(
        (entry) =>
          entry.path === paths.guardsRoot || entry.path === paths.writerLock,
      ),
    },
  };
}

function validatePlan(plan, receipt, paths, problems) {
  if (
    !sameKeys(plan, CUTOVER_PLAN_KEYS) ||
    plan.schemaVersion !== 1 ||
    plan.kind !== CUTOVER_PLAN_KIND ||
    plan.action !== "automation-guard.cutover.plan" ||
    !isCanonicalTimestamp(plan.createdAt) ||
    !IDENTIFIER_PATTERN.test(String(plan.taskId ?? "")) ||
    !sameKeys(plan.parameters, CUTOVER_PARAMETER_KEYS) ||
    plan.parameters.schemaVersion !== 1 ||
    plan.parameters.policy !== AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY ||
    plan.parameters.stateRoot !== paths.stateRoot ||
    !isCanonicalAbsolutePath(plan.parameters.codexHome) ||
    !isCanonicalAbsolutePath(plan.parameters.repoRoot) ||
    !GIT_OBJECT_ID_PATTERN.test(String(plan.parameters.sourceCodeSha ?? "")) ||
    !SHA256_PATTERN.test(String(plan.parameters.sourceSnapshotDigest ?? "")) ||
    !SHA256_PATTERN.test(String(plan.parameters.archiveManifestDigest ?? "")) ||
    plan.parameters.markerDigest !== AUTOMATION_KERNEL_GUARD_MARKER_DIGEST ||
    !Array.isArray(plan.parameters.guardNames) ||
    plan.parameters.guardNames.join("\n") !==
      AUTOMATION_KERNEL_GUARD_NAMES.join("\n") ||
    !SHA256_PATTERN.test(String(plan.parameters.cutoverId ?? "")) ||
    !sameKeys(plan.intent, CUTOVER_INTENT_KEYS) ||
    plan.intent.schemaVersion !== 1 ||
    plan.intent.action !== CUTOVER_ACTION ||
    plan.intent.taskId !== plan.taskId ||
    stableJson(plan.intent.parameters) !== stableJson(plan.parameters) ||
    canonicalIntentDigest(plan.intent) !== plan.intentDigest ||
    plan.intentDigest !== receipt.intentDigest ||
    plan.parameters.cutoverId !== receipt.cutoverId ||
    plan.parameters.sourceSnapshotDigest !== receipt.sourceSnapshotDigest ||
    plan.parameters.archiveManifestDigest !== receipt.archiveManifestDigest ||
    plan.parameters.markerDigest !== receipt.markerDigest ||
    plan.parameters.guardNames.join("\n") !== receipt.guardNames.join("\n") ||
    expectedCutoverId(plan) !== plan.parameters.cutoverId
  ) {
    problems.push(
      "Cutover plan does not satisfy the exact production governance contract",
    );
    return null;
  }
  return validateSourceSnapshot(plan, paths, problems);
}

function verifyArchivedSnapshotEntry(entry, archivePath, currentUid, problems) {
  if (entry?.kind === "missing") {
    try {
      lstatSync(archivePath);
      problems.push(`${archivePath} exists for a planned missing legacy path`);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        problems.push(`${archivePath} could not be admitted: ${String(error)}`);
      }
    }
    return;
  }
  if (entry?.kind === "file") {
    if (
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      typeof entry.digest !== "string" ||
      !SHA256_PATTERN.test(entry.digest) ||
      typeof entry.bytesBase64 !== "string"
    ) {
      problems.push(
        `${entry?.path ?? archivePath} has an invalid file snapshot`,
      );
      return;
    }
    const expectedBytes = Buffer.from(entry.bytesBase64, "base64");
    if (
      expectedBytes.length !== entry.size ||
      sha256(expectedBytes) !== entry.digest ||
      expectedBytes.toString("base64") !== entry.bytesBase64
    ) {
      problems.push(`${entry.path} has noncanonical archived source bytes`);
      return;
    }
    const actual = readPrivateFile(
      archivePath,
      currentUid,
      problems,
      entry.size,
    );
    if (actual !== null && !actual.equals(expectedBytes)) {
      problems.push(`${archivePath} does not preserve the exact legacy bytes`);
    }
    return;
  }
  if (entry?.kind !== "directory" || !Array.isArray(entry.entries)) {
    problems.push(
      `${entry?.path ?? archivePath} has an invalid directory snapshot`,
    );
    return;
  }
  if (!inspectPrivateDirectory(archivePath, currentUid, problems)) return;
  const expectedNames = [];
  for (const child of entry.entries) {
    const name = safeSnapshotBasename(child, problems);
    if (name !== null) expectedNames.push(name);
  }
  if (new Set(expectedNames).size !== expectedNames.length) {
    problems.push(`${entry.path} has duplicate archived occurrence names`);
    return;
  }
  let actualNames = [];
  try {
    actualNames = readdirSync(archivePath).sort();
  } catch (error) {
    problems.push(`${archivePath} could not be enumerated: ${String(error)}`);
    return;
  }
  if (actualNames.join("\n") !== expectedNames.sort().join("\n")) {
    problems.push(
      `${archivePath} does not preserve the exact legacy occurrence set`,
    );
    return;
  }
  for (const child of entry.entries) {
    const name = path.basename(child.path);
    verifyArchivedSnapshotEntry(
      child,
      path.join(archivePath, name),
      currentUid,
      problems,
    );
  }
}

function archivedSnapshotPaths(entry, archivePath) {
  if (entry?.kind === "missing") return [];
  if (entry?.kind === "file") return [archivePath];
  if (entry?.kind !== "directory" || !Array.isArray(entry.entries)) {
    return [archivePath];
  }
  return [
    archivePath,
    ...entry.entries.flatMap((child) =>
      archivedSnapshotPaths(
        child,
        path.join(archivePath, path.basename(String(child?.path ?? ""))),
      ),
    ),
  ];
}

function storedCutoverAuthorizationIsValid(
  plan,
  authorization,
  artifactDirectory,
) {
  let bytes;
  let confirmation;
  try {
    bytes = Buffer.from(authorization?.confirmationBytesBase64 ?? "", "base64");
    if (
      bytes.toString("base64") !== authorization.confirmationBytesBase64 ||
      sha256(bytes) !== authorization.confirmationRawDigest
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
  const validatedAtMs = Date.parse(String(authorization?.validatedAt ?? ""));
  const expectedArtifact = path.join(
    artifactDirectory,
    "authorizations",
    `${authorization.confirmationDigest}-${authorization.confirmationRawDigest}.json`,
  );
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
    sha256(Buffer.from(stableJson(confirmation.intent), "utf8")) ===
      plan.intentDigest &&
    sha256(Buffer.from(stableJson(confirmation), "utf8")) ===
      authorization.confirmationDigest &&
    isCanonicalTimestamp(confirmation.approvedAt) &&
    isCanonicalTimestamp(confirmation.expiresAt) &&
    expiresAtMs > approvedAtMs &&
    Number.isFinite(validatedAtMs) &&
    validatedAtMs >= approvedAtMs &&
    validatedAtMs < expiresAtMs &&
    isCanonicalAbsolutePath(authorization.confirmationPath) &&
    authorization.confirmationArtifact === expectedArtifact
  );
}

function expectedTransactionBytes(transaction) {
  const authorizations = transaction.authorizations.map((authorization) => ({
    actor: authorization.actor,
    confirmationId: authorization.confirmationId,
    confirmationDigest: authorization.confirmationDigest,
    confirmationPath: authorization.confirmationPath,
    confirmationBytesBase64: authorization.confirmationBytesBase64,
    confirmationRawDigest: authorization.confirmationRawDigest,
    confirmationArtifact: authorization.confirmationArtifact,
    intentDigest: authorization.intentDigest,
    validatedAt: authorization.validatedAt,
  }));
  const claimGenerations = transaction.claimGenerations.map((generation) => ({
    claimToken: generation.claimToken,
    claimedAt: generation.claimedAt,
    pid: generation.pid,
    processStartIdentity: generation.processStartIdentity,
  }));
  return prettyJsonBytes({
    schemaVersion: transaction.schemaVersion,
    kind: transaction.kind,
    cutoverId: transaction.cutoverId,
    planDigest: transaction.planDigest,
    phase: transaction.phase,
    preparedAt: transaction.preparedAt,
    authorizations,
    claimGenerations,
    completedAt: transaction.completedAt,
  });
}

function verifyCutoverPreparedEvidence({
  paths,
  receipt,
  artifactDirectory,
  currentUid,
  problems,
  resolveFilesystemType,
}) {
  let artifactNames = [];
  try {
    artifactNames = readdirSync(artifactDirectory).sort();
  } catch (error) {
    problems.push(
      `${artifactDirectory} could not be enumerated: ${String(error)}`,
    );
    return;
  }
  const expectedArtifactNames = [
    "authorizations",
    "legacy-locks.json",
    "legacy-paths",
    "plan.json",
    "receipt.json",
    "source-snapshot.json",
  ].sort();
  if (artifactNames.join("\n") !== expectedArtifactNames.join("\n")) {
    problems.push(
      `${artifactDirectory} does not contain the exact cutover evidence set`,
    );
    return;
  }

  const planPath = path.join(artifactDirectory, "plan.json");
  const sourcePath = path.join(artifactDirectory, "source-snapshot.json");
  const legacyPath = path.join(artifactDirectory, "legacy-locks.json");
  const legacyRoot = path.join(artifactDirectory, "legacy-paths");
  const artifactReceiptPath = path.join(artifactDirectory, "receipt.json");
  const authorizationRoot = path.join(artifactDirectory, "authorizations");
  const preparedAuthorizationPath = path.join(
    authorizationRoot,
    "prepared-authorization.json",
  );
  const planRecord = readJsonFile(
    planPath,
    currentUid,
    problems,
    AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES,
  );
  const sourceRecord = readJsonFile(
    sourcePath,
    currentUid,
    problems,
    AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES,
  );
  const legacyRecord = readJsonFile(
    legacyPath,
    currentUid,
    problems,
    AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES,
  );
  const transactionRecord = readJsonFile(
    paths.transaction,
    currentUid,
    problems,
    1024 * 1024,
  );
  if (
    planRecord === null ||
    sourceRecord === null ||
    legacyRecord === null ||
    transactionRecord === null
  ) {
    return;
  }
  const plan = planRecord.value;
  const source = sourceRecord.value;
  const legacy = legacyRecord.value;
  const transaction = transactionRecord.value;
  const sourceValidation = validatePlan(plan, receipt, paths, problems);
  if (!planRecord.bytes.equals(prettyJsonBytes(plan))) {
    problems.push(`${planPath} is not the exact pretty-printed cutover plan`);
  }
  if (
    sha256(sourceRecord.bytes) !== receipt.sourceSnapshotDigest ||
    !sourceRecord.bytes.equals(canonicalJsonBytes(source)) ||
    stableJson(plan.sourceSnapshot) !== stableJson(source)
  ) {
    problems.push(
      `${sourcePath} does not match its exact source snapshot digest`,
    );
  }
  const expectedLegacy = sourceValidation?.legacyManifest;
  if (
    sha256(legacyRecord.bytes) !== receipt.archiveManifestDigest ||
    !legacyRecord.bytes.equals(canonicalJsonBytes(legacy)) ||
    legacy?.schemaVersion !== 1 ||
    !Array.isArray(legacy?.entries) ||
    legacy.entries.length !== 2 ||
    expectedLegacy === undefined ||
    stableJson(legacy) !== stableJson(expectedLegacy)
  ) {
    problems.push(
      `${legacyPath} does not match the exact planned archive manifest`,
    );
    return;
  }
  const legacyByPath = new Map(
    legacy.entries.map((entry) => [entry?.path, entry]),
  );
  const writerEntry = legacyByPath.get(paths.writerLock);
  const guardsEntry = legacyByPath.get(paths.guardsRoot);
  if (writerEntry === undefined || guardsEntry === undefined) {
    problems.push(
      "Cutover legacy manifest does not bind the writer and guard roots",
    );
    return;
  }
  if (!inspectPrivateDirectory(legacyRoot, currentUid, problems)) return;
  const expectedLegacyRootNames = [
    ...(writerEntry.kind === "missing" ? [] : ["outcomes.jsonl.writer-lock"]),
    "guards",
  ].sort();
  const actualLegacyRootNames = readdirSync(legacyRoot).sort();
  if (actualLegacyRootNames.join("\n") !== expectedLegacyRootNames.join("\n")) {
    problems.push(`${legacyRoot} does not contain the exact archived roots`);
    return;
  }
  verifyArchivedSnapshotEntry(
    writerEntry,
    path.join(legacyRoot, "outcomes.jsonl.writer-lock"),
    currentUid,
    problems,
  );
  verifyArchivedSnapshotEntry(
    guardsEntry,
    path.join(legacyRoot, "guards"),
    currentUid,
    problems,
  );

  const evidenceFilesystemInspection =
    inspectAutomationKernelGuardFilesystemPaths(
      paths.stateRoot,
      [
        paths.globalReceipt,
        paths.transaction,
        paths.writeAhead,
        paths.bootstrapLock,
        artifactDirectory,
        planPath,
        sourcePath,
        legacyPath,
        legacyRoot,
        artifactReceiptPath,
        authorizationRoot,
        preparedAuthorizationPath,
        ...(Array.isArray(transaction?.authorizations)
          ? transaction.authorizations
              .map((authorization) => authorization?.confirmationArtifact)
              .filter((filePath) => typeof filePath === "string")
          : []),
        ...archivedSnapshotPaths(
          writerEntry,
          path.join(legacyRoot, "outcomes.jsonl.writer-lock"),
        ),
        ...archivedSnapshotPaths(guardsEntry, path.join(legacyRoot, "guards")),
      ],
      { resolveFilesystemType },
    );
  problems.push(...evidenceFilesystemInspection.problems);

  const transactionKeys = [
    "authorizations",
    "claimGenerations",
    "completedAt",
    "cutoverId",
    "kind",
    "phase",
    "planDigest",
    "preparedAt",
    "schemaVersion",
  ].sort();
  const authorizations = transaction?.authorizations;
  const claimGenerations = transaction?.claimGenerations;
  const planCreatedAtMs = Date.parse(String(plan?.createdAt ?? ""));
  const preparedAtMs = Date.parse(String(transaction?.preparedAt ?? ""));
  const completedAtMs = Date.parse(String(transaction?.completedAt ?? ""));
  const authorizationIdentities = Array.isArray(authorizations)
    ? authorizations.map((authorization) =>
        stableJson([
          authorization?.confirmationId,
          authorization?.confirmationDigest,
          authorization?.validatedAt,
        ]),
      )
    : [];
  const authorizationValid =
    Array.isArray(authorizations) &&
    authorizations.length > 0 &&
    authorizations.length <= CUTOVER_MAX_AUTHORIZATIONS &&
    new Set(authorizationIdentities).size === authorizations.length &&
    authorizations.every(
      (authorization, index) =>
        sameKeys(authorization, CUTOVER_TRANSACTION_AUTHORIZATION_KEYS) &&
        authorization.actor === "freed-owner" &&
        IDENTIFIER_PATTERN.test(String(authorization.confirmationId ?? "")) &&
        SHA256_PATTERN.test(String(authorization.confirmationDigest ?? "")) &&
        SHA256_PATTERN.test(
          String(authorization.confirmationRawDigest ?? ""),
        ) &&
        authorization.intentDigest === plan.intentDigest &&
        storedCutoverAuthorizationIsValid(
          plan,
          authorization,
          artifactDirectory,
        ) &&
        isCanonicalTimestamp(authorization.validatedAt) &&
        Date.parse(authorization.validatedAt) >= preparedAtMs &&
        (index === 0 ||
          Date.parse(authorization.validatedAt) >
            Date.parse(authorizations[index - 1].validatedAt)) &&
        Date.parse(authorization.validatedAt) <= completedAtMs,
    );
  const claimGenerationsValid =
    Array.isArray(claimGenerations) &&
    claimGenerations.length > 0 &&
    claimGenerations.length <= 64 &&
    new Set(claimGenerations.map((generation) => generation?.claimToken))
      .size === claimGenerations.length &&
    claimGenerations.every(
      (generation) =>
        sameKeys(generation, CUTOVER_CLAIM_GENERATION_KEYS) &&
        SHA256_PATTERN.test(String(generation.claimToken ?? "")) &&
        isCanonicalTimestamp(generation.claimedAt) &&
        Number.isSafeInteger(generation.pid) &&
        generation.pid > 0 &&
        typeof generation.processStartIdentity === "string" &&
        generation.processStartIdentity.length > 0 &&
        Date.parse(generation.claimedAt) >= preparedAtMs &&
        Date.parse(generation.claimedAt) <= completedAtMs,
    );
  const exactTransactionBytes =
    authorizationValid && claimGenerationsValid
      ? expectedTransactionBytes(transaction)
      : null;
  if (inspectPrivateDirectory(authorizationRoot, currentUid, problems)) {
    const expectedAuthorizationNames = authorizationValid
      ? [
          "prepared-authorization.json",
          ...new Set(
            authorizations.map((authorization) =>
              path.basename(authorization.confirmationArtifact),
            ),
          ),
        ].sort()
      : [];
    const actualAuthorizationNames = readdirSync(authorizationRoot).sort();
    if (
      actualAuthorizationNames.join("\n") !==
      expectedAuthorizationNames.join("\n")
    ) {
      problems.push(
        `${authorizationRoot} does not contain the exact authorization evidence set`,
      );
    } else if (authorizationValid) {
      const preparedAuthorization = readPrivateFile(
        preparedAuthorizationPath,
        currentUid,
        problems,
        128 * 1024,
      );
      if (
        preparedAuthorization !== null &&
        !preparedAuthorization.equals(prettyJsonBytes(authorizations[0]))
      ) {
        problems.push(
          `${preparedAuthorizationPath} does not bind the first validated authorization`,
        );
      }
      for (const authorization of authorizations) {
        const evidence = readPrivateFile(
          authorization.confirmationArtifact,
          currentUid,
          problems,
          64 * 1024,
        );
        if (
          evidence !== null &&
          (sha256(evidence) !== authorization.confirmationRawDigest ||
            evidence.toString("base64") !==
              authorization.confirmationBytesBase64)
        ) {
          problems.push(
            `${authorization.confirmationArtifact} does not match its validated confirmation`,
          );
        }
      }
    }
  }
  if (
    !sameKeys(transaction, transactionKeys) ||
    !authorizationValid ||
    !claimGenerationsValid ||
    exactTransactionBytes === null ||
    !transactionRecord.bytes.equals(exactTransactionBytes) ||
    transaction.schemaVersion !== 1 ||
    transaction.kind !== CUTOVER_TRANSACTION_KIND ||
    transaction.phase !== "receipt-prepared" ||
    transaction.cutoverId !== receipt.cutoverId ||
    transaction.completedAt !== receipt.completedAt ||
    !isCanonicalTimestamp(transaction.preparedAt) ||
    !isCanonicalTimestamp(transaction.completedAt) ||
    planCreatedAtMs > preparedAtMs ||
    preparedAtMs > completedAtMs ||
    transaction.planDigest !== sha256(canonicalJsonBytes(plan)) ||
    receipt.transactionDigest !== sha256(transactionRecord.bytes) ||
    authorizations?.at(-1)?.validatedAt !== transaction.completedAt ||
    authorizations?.at(-1)?.confirmationId !== receipt.confirmationId ||
    authorizations?.at(-1)?.confirmationDigest !== receipt.confirmationDigest ||
    authorizations?.at(-1)?.intentDigest !== receipt.intentDigest
  ) {
    problems.push(
      `${paths.transaction} does not authenticate the completed cutover`,
    );
  }
}

export function inspectAutomationKernelGuardCutover(
  stateRoot,
  { resolveFilesystemType = resolveAutomationKernelGuardFilesystemType } = {},
) {
  const paths = automationKernelGuardCutoverPaths(stateRoot);
  const problems = [];
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : 0;

  const stateReady = inspectPrivateDirectory(
    paths.stateRoot,
    currentUid,
    problems,
  );
  if (stateReady) {
    const filesystemInspection = inspectAutomationKernelGuardFilesystemPaths(
      paths.stateRoot,
      [
        paths.stateRoot,
        paths.controlRoot,
        paths.guardsRoot,
        paths.globalReceipt,
        paths.transaction,
        paths.writeAhead,
        paths.bootstrapLock,
        paths.writerLock,
        path.dirname(paths.artifactRoot),
        paths.artifactRoot,
        ...AUTOMATION_KERNEL_GUARD_NAMES.flatMap((name) => {
          const guard = paths.guards[name];
          return [guard.directory, guard.owner, guard.inner];
        }),
      ],
      { resolveFilesystemType },
    );
    problems.push(...filesystemInspection.problems);
  }
  const controlReady =
    stateReady &&
    inspectPrivateDirectory(paths.controlRoot, currentUid, problems);
  const guardsReady =
    controlReady &&
    inspectPrivateDirectory(paths.guardsRoot, currentUid, problems);

  let receipt = null;
  let globalReceiptRecord = null;
  if (controlReady) {
    const admitted = readJsonFile(paths.globalReceipt, currentUid, problems);
    if (
      admitted !== null &&
      sameKeys(admitted.value, GLOBAL_RECEIPT_KEYS) &&
      validReceiptCore(admitted.value, paths.stateRoot) &&
      typeof admitted.value.artifactReceipt === "string" &&
      path.isAbsolute(admitted.value.artifactReceipt) &&
      SHA256_PATTERN.test(String(admitted.value.artifactReceiptDigest ?? ""))
    ) {
      receipt = admitted.value;
      globalReceiptRecord = admitted;
    } else if (admitted !== null) {
      problems.push(`${paths.globalReceipt} has an unsupported receipt shape`);
    }
  }

  if (receipt !== null) {
    try {
      lstatSync(paths.writeAhead);
      problems.push(
        `${paths.writeAhead} remains pending after cutover activation`,
      );
    } catch (error) {
      if (error?.code !== "ENOENT") {
        problems.push(
          `${paths.writeAhead} could not be admitted: ${String(error)}`,
        );
      }
    }
    if (!globalReceiptRecord.bytes.equals(exactGlobalReceiptBytes(receipt))) {
      problems.push(
        `${paths.globalReceipt} is not the exact pretty-printed activated receipt`,
      );
    }
    const expectedArtifactDirectory = path.join(
      paths.artifactRoot,
      receipt.cutoverId,
    );
    const artifactRootParent = path.dirname(paths.artifactRoot);
    const ancestryReady =
      inspectPrivateDirectory(artifactRootParent, currentUid, problems) &&
      inspectPrivateDirectory(paths.artifactRoot, currentUid, problems) &&
      inspectPrivateDirectory(expectedArtifactDirectory, currentUid, problems);
    const expectedArtifactReceipt = path.join(
      expectedArtifactDirectory,
      "receipt.json",
    );
    const artifactFilesystemInspection =
      inspectAutomationKernelGuardFilesystemPaths(
        paths.stateRoot,
        [expectedArtifactDirectory, expectedArtifactReceipt],
        { resolveFilesystemType },
      );
    problems.push(...artifactFilesystemInspection.problems);
    if (
      !ancestryReady ||
      receipt.artifactReceipt !== expectedArtifactReceipt ||
      path.relative(paths.stateRoot, receipt.artifactReceipt).startsWith("..")
    ) {
      problems.push(
        `${paths.globalReceipt} does not name the canonical cutover artifact receipt`,
      );
    } else {
      const artifact = readJsonFile(
        receipt.artifactReceipt,
        currentUid,
        problems,
      );
      const core = Object.fromEntries(
        RECEIPT_CORE_KEYS.map((key) => [key, receipt[key]]),
      );
      if (
        artifact === null ||
        !sameKeys(artifact.value, RECEIPT_CORE_KEYS) ||
        !validReceiptCore(artifact.value, paths.stateRoot) ||
        !artifact.bytes.equals(
          canonicalAutomationKernelGuardReceiptBytes(core),
        ) ||
        sha256(artifact.bytes) !== receipt.artifactReceiptDigest
      ) {
        problems.push(
          `${receipt.artifactReceipt} does not match the activated cutover receipt`,
        );
      }
      verifyCutoverPreparedEvidence({
        paths,
        receipt,
        artifactDirectory: expectedArtifactDirectory,
        currentUid,
        problems,
        resolveFilesystemType,
      });
    }
  }

  if (guardsReady) {
    const markerBytes = automationKernelGuardMarkerBytes();
    try {
      const names = readdirSync(paths.guardsRoot).sort();
      const expected = AUTOMATION_KERNEL_GUARD_NAMES.map(
        (name) => `${name}.lock`,
      ).sort();
      if (names.join("\n") !== expected.join("\n")) {
        problems.push(
          `${paths.guardsRoot} does not contain exactly the canonical guard set`,
        );
      }
    } catch (error) {
      problems.push(
        `${paths.guardsRoot} could not be enumerated: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const name of AUTOMATION_KERNEL_GUARD_NAMES) {
      const guard = paths.guards[name];
      if (!inspectPrivateDirectory(guard.directory, currentUid, problems)) {
        continue;
      }
      try {
        const entries = readdirSync(guard.directory).sort();
        const expectedEntries = [
          AUTOMATION_KERNEL_GUARD_INNER_FILE,
          AUTOMATION_KERNEL_GUARD_OWNER_FILE,
        ].sort();
        if (entries.join("\n") !== expectedEntries.join("\n")) {
          problems.push(
            `${guard.directory} does not contain exactly the owner sentinel and inner kernel lock`,
          );
        }
      } catch (error) {
        problems.push(
          `${guard.directory} could not be enumerated: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      for (const markerPath of [guard.owner, guard.inner]) {
        const marker = readPrivateFile(
          markerPath,
          currentUid,
          problems,
          markerBytes.length,
        );
        if (marker !== null && !marker.equals(markerBytes)) {
          problems.push(
            `${markerPath} does not contain the exact guard marker`,
          );
        }
      }
    }
  }

  if (stateReady) {
    const markerBytes = automationKernelGuardMarkerBytes();
    for (const markerPath of [paths.writerLock, paths.bootstrapLock]) {
      const marker = readPrivateFile(
        markerPath,
        currentUid,
        problems,
        markerBytes.length,
      );
      if (marker !== null && !marker.equals(markerBytes)) {
        problems.push(`${markerPath} does not contain the exact guard marker`);
      }
    }
  }

  return { ready: problems.length === 0, problems, paths, receipt };
}
