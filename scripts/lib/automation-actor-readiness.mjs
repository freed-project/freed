import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

const ACTOR_CREDENTIAL_PURPOSE = "automation-actor-lease";
export const ACTOR_LAUNCHER_PURPOSE = "automation-actor-launcher";
export const ACTOR_LAUNCHER_HANDOFF = "keychain-to-canonical-lease";
export const ACTOR_LAUNCHER_ATTESTATION_PROTOCOL =
  "freed-actor-launcher-readiness-v1";
const ACTOR_LAUNCHER_ATTESTATION_PURPOSE =
  "automation-actor-launcher-readiness";
export const ACTOR_LAUNCHER_RECORD_ROOT =
  "/Library/Application Support/Freed/automation-actor-launchers";
export const ACTOR_RUNTIME_ROOT =
  "/Library/Application Support/Freed/automation-actor-runtimes";
const ACTOR_RUNTIME_DIGEST_PROTOCOL =
  "freed-automation-actor-runtime-v1";
export const LAUNCHER_ATTESTATION_TIMEOUT_MS = 5_000;
const MAX_LAUNCHER_ATTESTATION_BYTES = 16 * 1_024;

const BINDING_KEYS = Object.freeze(
  [
    "actor",
    "attestationProtocol",
    "controlEntryPath",
    "controlEntrySha256",
    "controlLibraryPath",
    "controlLibrarySha256",
    "handoff",
    "keychainAccount",
    "keychainService",
    "leaseName",
    "launcherPath",
    "launcherSha256",
    "maxLeaseLifetimeMs",
    "nodePath",
    "nodeSha256",
    "purpose",
    "schemaVersion",
    "stateRoot",
  ].sort(),
);

const ATTESTATION_KEYS = Object.freeze(
  [
    "actor",
    "canonicalLeaseReady",
    "credentialDigestVerified",
    "credentialSha256",
    "handoff",
    "keychainAccount",
    "keychainService",
    "leaseName",
    "maxLeaseLifetimeMs",
    "mutatesState",
    "protocol",
    "purpose",
    "schemaVersion",
    "stateRoot",
  ].sort(),
);

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\n") === keys.join("\n")
  );
}

function isStrictChildPath(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : -1;
}

function readOwnerCredentialFile(filePath, requiredUid) {
  const descriptor = openSync(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stats = fstatSync(descriptor);
    if (
      realpathSync(filePath) !== filePath ||
      !stats.isFile() ||
      stats.uid !== requiredUid ||
      (stats.mode & 0o777) !== 0o600
    ) {
      return {
        ready: false,
        reason: "credential record is not an owner-held mode 0600 regular file",
      };
    }
    return { ready: true, contents: readFileSync(descriptor, "utf8") };
  } finally {
    closeSync(descriptor);
  }
}

export function actorCredentialReadiness(
  stateRoot,
  actor,
  { requiredUid = currentUid() } = {},
) {
  const credentialPath = path.join(
    path.resolve(stateRoot),
    "control",
    "actor-credentials",
    `${actor}.json`,
  );
  try {
    if (
      typeof constants.O_NOFOLLOW !== "number" ||
      typeof constants.O_NONBLOCK !== "number"
    ) {
      return {
        ready: false,
        path: credentialPath,
        reason:
          "credential record cannot be opened with safe link and blocking controls",
      };
    }
    const credentialRecord = readOwnerCredentialFile(
      credentialPath,
      requiredUid,
    );
    if (!credentialRecord.ready) {
      return {
        ready: false,
        path: credentialPath,
        reason: credentialRecord.reason,
      };
    }
    const credential = JSON.parse(credentialRecord.contents);
    const tokenSha256 = String(credential?.tokenSha256 ?? "");
    if (
      !exactKeys(
        credential,
        ["actor", "purpose", "schemaVersion", "tokenSha256"].sort(),
      ) ||
      credential.schemaVersion !== 1 ||
      credential.actor !== actor ||
      credential.purpose !== ACTOR_CREDENTIAL_PURPOSE ||
      !isSha256(tokenSha256)
    ) {
      return {
        ready: false,
        path: credentialPath,
        reason: "credential record identity or digest is invalid",
      };
    }
    return {
      ready: true,
      path: credentialPath,
      reason: "",
      tokenSha256,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        ready: false,
        path: credentialPath,
        reason: "credential record is missing",
      };
    }
    return {
      ready: false,
      path: credentialPath,
      reason: `credential record cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function inspectImmutableParents(filePath, rootPath, requiredUid, label) {
  const root = path.resolve(rootPath);
  let current = path.dirname(filePath);
  while (true) {
    const stats = lstatSync(current);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      stats.uid !== requiredUid ||
      (stats.mode & 0o022) !== 0
    ) {
      return {
        ready: false,
        reason: `${label} has a non-root-owned or writable directory in its path`,
      };
    }
    if (current === root) return { ready: true, reason: "" };
    const parent = path.dirname(current);
    if (parent === current || !isStrictChildPath(root, current)) {
      return { ready: false, reason: `${label} escapes its trusted root` };
    }
    current = parent;
  }
}

export function inspectRootOwnedRecord(
  recordPath,
  { recordRoot = ACTOR_LAUNCHER_RECORD_ROOT, requiredUid = 0 } = {},
) {
  try {
    const root = path.resolve(recordRoot);
    if (
      !path.isAbsolute(recordRoot) ||
      realpathSync(root) !== root ||
      !path.isAbsolute(recordPath) ||
      realpathSync(recordPath) !== recordPath ||
      !isStrictChildPath(root, recordPath)
    ) {
      return { ready: false, reason: "launcher record path is not canonical" };
    }
    const stats = lstatSync(recordPath);
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.uid !== requiredUid ||
      (stats.mode & 0o022) !== 0
    ) {
      return {
        ready: false,
        reason: "launcher record is not root-owned and immutable",
      };
    }
    return inspectImmutableParents(
      recordPath,
      root,
      requiredUid,
      "launcher record",
    );
  } catch (error) {
    return {
      ready: false,
      reason: `launcher record cannot be inspected: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function inspectRootOwnedExecutable(
  launcherPath,
  { launcherRoot = ACTOR_LAUNCHER_RECORD_ROOT, requiredUid = 0 } = {},
) {
  try {
    const root = path.resolve(launcherRoot);
    if (
      !path.isAbsolute(launcherRoot) ||
      realpathSync(root) !== root ||
      !path.isAbsolute(launcherPath) ||
      realpathSync(launcherPath) !== launcherPath ||
      !isStrictChildPath(root, launcherPath)
    ) {
      return {
        ready: false,
        reason: "launcher path is not a canonical absolute path",
      };
    }
    const stats = lstatSync(launcherPath);
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.uid !== requiredUid ||
      (stats.mode & 0o022) !== 0 ||
      (stats.mode & 0o111) === 0
    ) {
      return {
        ready: false,
        reason: "launcher is not a root-owned immutable executable",
      };
    }
    return inspectImmutableParents(
      launcherPath,
      root,
      requiredUid,
      "launcher",
    );
  } catch (error) {
    return {
      ready: false,
      reason: `launcher cannot be inspected: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function inspectRootOwnedRuntimeFile(
  runtimePath,
  runtimeRoot = ACTOR_RUNTIME_ROOT,
  { requiredUid = 0 } = {},
) {
  try {
    const root = path.resolve(runtimeRoot);
    if (!path.isAbsolute(runtimeRoot) || realpathSync(root) !== root) {
      return {
        ready: false,
        reason: "automation actor runtime root is not canonical",
      };
    }
    if (
      !path.isAbsolute(runtimePath) ||
      realpathSync(runtimePath) !== runtimePath ||
      !isStrictChildPath(root, runtimePath)
    ) {
      return {
        ready: false,
        reason:
          "runtime pin is not a canonical path under the automation actor runtime root",
      };
    }
    const stats = lstatSync(runtimePath);
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.uid !== requiredUid ||
      (stats.mode & 0o022) !== 0
    ) {
      return {
        ready: false,
        reason: "runtime pin is not a root-owned immutable regular file",
      };
    }
    return inspectImmutableParents(
      runtimePath,
      root,
      requiredUid,
      "runtime pin",
    );
  } catch (error) {
    return {
      ready: false,
      reason: `runtime pin cannot be inspected: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function runtimeDigestForPins(pins) {
  return createHash("sha256")
    .update(
      [
        ACTOR_RUNTIME_DIGEST_PROTOCOL,
        `node:${pins.nodeSha256}`,
        `automation-control.mjs:${pins.controlEntrySha256}`,
        `lib/automation-control.mjs:${pins.controlLibrarySha256}`,
        "",
      ].join("\n"),
    )
    .digest("hex");
}

export function validateActorBindingRecord(
  record,
  {
    actor,
    stateRoot,
    leaseContract,
    launcherRoot = ACTOR_LAUNCHER_RECORD_ROOT,
    runtimeRoot = ACTOR_RUNTIME_ROOT,
    requiredUid = 0,
    launcherInspector = inspectRootOwnedExecutable,
    runtimeFileInspector = inspectRootOwnedRuntimeFile,
  },
) {
  try {
    const canonicalStateRoot = realpathSync(path.resolve(stateRoot));
    const canonicalLauncherRoot = realpathSync(path.resolve(launcherRoot));
    const canonicalRuntimeRoot = realpathSync(path.resolve(runtimeRoot));
    const runtimeDigest = path.basename(path.dirname(record?.nodePath ?? ""));
    const runtimeDirectory = path.join(canonicalRuntimeRoot, runtimeDigest);
    const launcherPath = path.join(
      canonicalLauncherRoot,
      "bin",
      `${actor}-${String(record?.launcherSha256 ?? "")}`,
    );
    if (
      !leaseContract ||
      typeof leaseContract.name !== "string" ||
      !Number.isSafeInteger(leaseContract.maxLifetimeMs) ||
      leaseContract.maxLifetimeMs <= 0 ||
      !exactKeys(record, BINDING_KEYS) ||
      record.schemaVersion !== 1 ||
      record.actor !== actor ||
      record.purpose !== ACTOR_LAUNCHER_PURPOSE ||
      record.handoff !== ACTOR_LAUNCHER_HANDOFF ||
      record.attestationProtocol !== ACTOR_LAUNCHER_ATTESTATION_PROTOCOL ||
      record.keychainService !== "freed-automation-actor" ||
      record.keychainAccount !== actor ||
      record.stateRoot !== canonicalStateRoot ||
      record.leaseName !== leaseContract.name ||
      record.maxLeaseLifetimeMs !== leaseContract.maxLifetimeMs ||
      record.launcherPath !== launcherPath ||
      !isSha256(record.launcherSha256) ||
      !isSha256(record.nodeSha256) ||
      !isSha256(record.controlEntrySha256) ||
      !isSha256(record.controlLibrarySha256) ||
      !isSha256(runtimeDigest) ||
      record.nodePath !== path.join(runtimeDirectory, "node") ||
      record.controlEntryPath !==
        path.join(runtimeDirectory, "automation-control.mjs") ||
      record.controlLibraryPath !==
        path.join(runtimeDirectory, "lib", "automation-control.mjs") ||
      runtimeDigestForPins(record) !== runtimeDigest
    ) {
      return {
        ready: false,
        reason: "trusted launcher record identity or handoff contract is invalid",
      };
    }
    const launcher = launcherInspector(record.launcherPath, {
      launcherRoot: canonicalLauncherRoot,
      requiredUid,
    });
    if (!launcher.ready) return launcher;
    if (sha256File(record.launcherPath) !== record.launcherSha256) {
      return {
        ready: false,
        reason: "trusted launcher digest does not match",
      };
    }
    const pins = [
      ["node", record.nodePath, record.nodeSha256],
      [
        "automation control entry",
        record.controlEntryPath,
        record.controlEntrySha256,
      ],
      [
        "automation control library",
        record.controlLibraryPath,
        record.controlLibrarySha256,
      ],
    ];
    for (const [label, pinPath, digest] of pins) {
      const inspection = runtimeFileInspector(
        pinPath,
        canonicalRuntimeRoot,
        { requiredUid },
      );
      if (!inspection.ready) {
        return {
          ready: false,
          reason: `${label} pin is invalid: ${inspection.reason}`,
        };
      }
      if (sha256File(pinPath) !== digest) {
        return { ready: false, reason: `${label} pin digest does not match` };
      }
    }
    return {
      ready: true,
      reason: "",
      binding: record,
      stateRoot: canonicalStateRoot,
      launcherRoot: canonicalLauncherRoot,
      runtimeRoot: canonicalRuntimeRoot,
      runtimeDigest,
    };
  } catch (error) {
    return {
      ready: false,
      reason: `trusted launcher record cannot be validated: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function readInstalledActorBinding(
  stateRoot,
  actor,
  {
    leaseContract,
    launcherRecordRoot = ACTOR_LAUNCHER_RECORD_ROOT,
    runtimeRoot = ACTOR_RUNTIME_ROOT,
    requiredUid = 0,
    launcherInspector = inspectRootOwnedExecutable,
    launcherRecordInspector = inspectRootOwnedRecord,
    runtimeFileInspector = inspectRootOwnedRuntimeFile,
  } = {},
) {
  const recordPath = path.join(path.resolve(launcherRecordRoot), `${actor}.json`);
  if (!existsSync(recordPath)) {
    return {
      ready: false,
      path: recordPath,
      reason: "trusted launcher record is missing",
    };
  }
  try {
    const recordInspection = launcherRecordInspector(recordPath, {
      recordRoot: launcherRecordRoot,
      requiredUid,
    });
    if (!recordInspection.ready) {
      return {
        ready: false,
        path: recordPath,
        reason: recordInspection.reason,
      };
    }
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    const validation = validateActorBindingRecord(record, {
      actor,
      stateRoot,
      leaseContract,
      launcherRoot: launcherRecordRoot,
      runtimeRoot,
      requiredUid,
      launcherInspector,
      runtimeFileInspector,
    });
    return { ...validation, path: recordPath };
  } catch (error) {
    return {
      ready: false,
      path: recordPath,
      reason: `trusted launcher record cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function validateLauncherAttestation(attestation, expected) {
  if (
    !exactKeys(attestation, ATTESTATION_KEYS) ||
    attestation.schemaVersion !== 1 ||
    attestation.protocol !== ACTOR_LAUNCHER_ATTESTATION_PROTOCOL ||
    attestation.purpose !== ACTOR_LAUNCHER_ATTESTATION_PURPOSE ||
    attestation.actor !== expected.actor ||
    attestation.stateRoot !== expected.stateRoot ||
    attestation.leaseName !== expected.leaseName ||
    attestation.maxLeaseLifetimeMs !== expected.maxLeaseLifetimeMs ||
    attestation.credentialSha256 !== expected.credentialSha256 ||
    attestation.handoff !== ACTOR_LAUNCHER_HANDOFF ||
    attestation.keychainService !== expected.keychainService ||
    attestation.keychainAccount !== expected.keychainAccount ||
    attestation.credentialDigestVerified !== true ||
    attestation.canonicalLeaseReady !== true ||
    attestation.mutatesState !== false
  ) {
    return {
      ready: false,
      reason:
        "trusted launcher readiness attestation does not match the actor handoff contract",
    };
  }
  return { ready: true, reason: "" };
}

export function parseLauncherAttestation(stdout, expected) {
  const text = String(stdout ?? "");
  if (Buffer.byteLength(text, "utf8") > MAX_LAUNCHER_ATTESTATION_BYTES) {
    return {
      ready: false,
      reason: "trusted launcher readiness attestation exceeded its output bound",
    };
  }
  try {
    const attestation = JSON.parse(text);
    const validation = validateLauncherAttestation(attestation, expected);
    return validation.ready
      ? { ready: true, reason: "", attestation }
      : validation;
  } catch {
    return {
      ready: false,
      reason:
        "trusted launcher readiness attestation did not return one JSON object",
    };
  }
}

export function defaultLauncherAttestor(
  request,
  { timeoutMs = LAUNCHER_ATTESTATION_TIMEOUT_MS } = {},
) {
  const result = spawnSync(
    request.launcherPath,
    [
      "--attest-readiness",
      "--protocol",
      ACTOR_LAUNCHER_ATTESTATION_PROTOCOL,
      "--actor",
      request.actor,
      "--state-root",
      request.stateRoot,
      "--lease-name",
      request.leaseName,
      "--max-lifetime-ms",
      String(request.maxLeaseLifetimeMs),
      "--credential-sha256",
      request.credentialSha256,
      "--keychain-service",
      request.keychainService,
      "--keychain-account",
      request.keychainAccount,
    ],
    {
      cwd: "/",
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
      maxBuffer: 64 * 1_024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    },
  );
  if (result.error) {
    const timedOut = result.error.code === "ETIMEDOUT";
    return {
      ready: false,
      reason: timedOut
        ? `trusted launcher readiness attestation exceeded ${timeoutMs.toLocaleString()} ms`
        : `trusted launcher readiness attestation failed: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return {
      ready: false,
      reason: Number.isInteger(result.status)
        ? `trusted launcher readiness attestation exited with status ${result.status.toLocaleString()}`
        : "trusted launcher readiness attestation ended without an exit status",
    };
  }
  return parseLauncherAttestation(result.stdout, request);
}

export function actorLauncherReadiness(
  stateRoot,
  actor,
  {
    credential = undefined,
    leaseContract = undefined,
    launcherAttestor = defaultLauncherAttestor,
    attestationTimeoutMs = LAUNCHER_ATTESTATION_TIMEOUT_MS,
    ...bindingOptions
  } = {},
) {
  const credentialReadiness =
    credential ??
    actorCredentialReadiness(stateRoot, actor, {
      requiredUid: bindingOptions.credentialUid ?? currentUid(),
    });
  const installed = readInstalledActorBinding(stateRoot, actor, {
    leaseContract,
    ...bindingOptions,
  });
  if (!installed.ready) return installed;
  if (!credentialReadiness.ready || !isSha256(credentialReadiness.tokenSha256)) {
    return {
      ready: false,
      path: credentialReadiness.path,
      reason:
        credentialReadiness.reason ||
        "credential digest must be ready before launcher attestation",
    };
  }
  const expected = {
    actor,
    stateRoot: installed.stateRoot,
    leaseName: leaseContract.name,
    maxLeaseLifetimeMs: leaseContract.maxLifetimeMs,
    credentialSha256: credentialReadiness.tokenSha256,
    keychainService: installed.binding.keychainService,
    keychainAccount: installed.binding.keychainAccount,
  };
  const attestationResult = launcherAttestor(
    { launcherPath: installed.binding.launcherPath, ...expected },
    { timeoutMs: attestationTimeoutMs },
  );
  if (!attestationResult.ready) {
    return {
      ready: false,
      path: installed.path,
      reason: attestationResult.reason,
    };
  }
  const validation = validateLauncherAttestation(
    attestationResult.attestation,
    expected,
  );
  if (!validation.ready) {
    return { ready: false, path: installed.path, reason: validation.reason };
  }
  return {
    ...installed,
    credentialPath: credentialReadiness.path,
    credentialSha256: credentialReadiness.tokenSha256,
    launcherPath: installed.binding.launcherPath,
    handoff: installed.binding.handoff,
    leaseName: installed.binding.leaseName,
    maxLeaseLifetimeMs: installed.binding.maxLeaseLifetimeMs,
    nodePath: installed.binding.nodePath,
    controlEntryPath: installed.binding.controlEntryPath,
    controlLibraryPath: installed.binding.controlLibraryPath,
    attestation: attestationResult.attestation,
  };
}
