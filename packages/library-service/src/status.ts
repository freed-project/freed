import path from "node:path";

import {
  LIBRARY_SERVICE_MAX_STATUS_BYTES,
  LIBRARY_SERVICE_FAILURE_CODES,
  LIBRARY_SERVICE_STATUS_SCHEMA_VERSION,
  LibraryServiceFailure,
  type LibraryServiceAclProofPort,
  type LibraryServiceBoundPath,
  type LibraryServiceConfig,
  type LibraryServiceFailureCode,
  type LibraryServiceFileSystemPort,
  type LibraryServiceIdentityPort,
  type LibraryServiceStatusRecord,
  type LibraryServiceStatusReport,
} from "./contracts.js";

const STATUS_KEYS = new Set([
  "schemaVersion",
  "service",
  "role",
  "phase",
  "updatedAt",
  "startedAt",
  "sidecarPid",
  "reasonCode",
]);
const PHASES = new Set(["starting", "running", "stopping", "stopped", "failed"]);
const REASON_CODES = new Set([
  ...LIBRARY_SERVICE_FAILURE_CODES,
  "requested_stop",
]);

function libraryServiceStatusPath(config: LibraryServiceConfig): string {
  return path.join(config.stateRoot, "library-service-status.json");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function parseStatus(text: string): LibraryServiceStatusRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LibraryServiceFailure("status_invalid");
  }
  if (!isObject(raw)) {
    throw new LibraryServiceFailure("status_invalid");
  }
  const keys = Object.keys(raw);
  if (keys.length !== STATUS_KEYS.size || !keys.every((key) => STATUS_KEYS.has(key))) {
    throw new LibraryServiceFailure("status_invalid");
  }
  if (
    raw.schemaVersion !== LIBRARY_SERVICE_STATUS_SCHEMA_VERSION ||
    raw.service !== "freed-library" ||
    raw.role !== "primary" ||
    typeof raw.phase !== "string" ||
    !PHASES.has(raw.phase) ||
    !isIsoDate(raw.updatedAt) ||
    (raw.startedAt !== null && !isIsoDate(raw.startedAt)) ||
    (raw.sidecarPid !== null &&
      (typeof raw.sidecarPid !== "number" ||
        !Number.isSafeInteger(raw.sidecarPid) ||
        raw.sidecarPid <= 0)) ||
    (raw.reasonCode !== null &&
      (typeof raw.reasonCode !== "string" || !REASON_CODES.has(raw.reasonCode)))
  ) {
    throw new LibraryServiceFailure("status_invalid");
  }
  return raw as unknown as LibraryServiceStatusRecord;
}

export async function writeLibraryServiceStatus(
  statusFile: LibraryServiceBoundPath,
  fileSystem: LibraryServiceFileSystemPort,
  status: LibraryServiceStatusRecord,
): Promise<void> {
  try {
    await fileSystem.writePrivateStatusText(
      statusFile,
      `${JSON.stringify(status)}\n`,
    );
  } catch {
    throw new LibraryServiceFailure("write_failed");
  }
}

export async function bindLibraryServiceStatusFile(
  config: LibraryServiceConfig,
  stateRoot: LibraryServiceBoundPath,
  fileSystem: LibraryServiceFileSystemPort,
  identity: LibraryServiceIdentityPort,
  aclProof: LibraryServiceAclProofPort,
): Promise<LibraryServiceBoundPath | null> {
  const userId = identity.currentUserId();
  if (userId === null) {
    throw new LibraryServiceFailure("unsupported_secret_store_or_acl_backend");
  }
  let statusFile: LibraryServiceBoundPath | null = null;
  try {
    statusFile = await fileSystem.openPrivateStatusFile(
      stateRoot,
      config.stateRoot,
      userId,
    );
    if (statusFile === null) return null;
    await aclProof.assertNoExtendedAcl([
      {
        path: libraryServiceStatusPath(config),
        device: statusFile.metadata.device,
        inode: statusFile.metadata.inode,
      },
    ]);
    await statusFile.assertStable();
    await statusFile.assertPathStable();
    await stateRoot.assertStable();
    await stateRoot.assertPathStable();
    return statusFile;
  } catch (error) {
    await statusFile?.close().catch(() => undefined);
    if (error instanceof LibraryServiceFailure) throw error;
    throw new LibraryServiceFailure("status_invalid");
  }
}

export async function readLibraryServiceStatus(
  statusFile: LibraryServiceBoundPath | null,
  fileSystem: LibraryServiceFileSystemPort,
): Promise<LibraryServiceStatusReport> {
  if (statusFile === null) {
    return {
      schemaVersion: 1,
      service: "freed-library",
      configuredRole: "primary",
      status: null,
    };
  }
  let text: string;
  try {
    text = await fileSystem.readPrivateStatusText(
      statusFile,
      LIBRARY_SERVICE_MAX_STATUS_BYTES,
    );
  } catch (error) {
    if (error instanceof LibraryServiceFailure) throw error;
    throw new LibraryServiceFailure("status_invalid");
  }
  if (text === "") {
    return {
      schemaVersion: 1,
      service: "freed-library",
      configuredRole: "primary",
      status: null,
    };
  }
  return {
    schemaVersion: 1,
    service: "freed-library",
    configuredRole: "primary",
    status: parseStatus(text),
  };
}

export function createLibraryServiceStatusRecord(input: {
  phase: LibraryServiceStatusRecord["phase"];
  nowMs: number;
  startedAt: string | null;
  sidecarPid: number | null;
  reasonCode: LibraryServiceFailureCode | "requested_stop" | null;
}): LibraryServiceStatusRecord {
  return {
    schemaVersion: LIBRARY_SERVICE_STATUS_SCHEMA_VERSION,
    service: "freed-library",
    role: "primary",
    phase: input.phase,
    updatedAt: new Date(input.nowMs).toISOString(),
    startedAt: input.startedAt,
    sidecarPid: input.sidecarPid,
    reasonCode: input.reasonCode,
  };
}
