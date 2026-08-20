export const LIBRARY_SERVICE_CONFIG_SCHEMA_VERSION = 1 as const;
export const LIBRARY_SERVICE_PROTOCOL_VERSION = 1 as const;
export const LIBRARY_SERVICE_STATUS_SCHEMA_VERSION = 1 as const;
export const LIBRARY_SERVICE_MAX_CONFIG_BYTES = 32 * 1_024;
export const LIBRARY_SERVICE_MAX_DESCRIPTOR_BYTES = 4 * 1_024;
export const LIBRARY_SERVICE_MAX_CONTROL_BYTES = 4 * 1_024;
export const LIBRARY_SERVICE_MAX_STATUS_BYTES = 4 * 1_024;
export const LIBRARY_SERVICE_EXECUTABLE_FD = 3 as const;
export const LIBRARY_SERVICE_DATA_ROOT_FD = 4 as const;
export const LIBRARY_SERVICE_STATE_ROOT_FD = 5 as const;
export const LIBRARY_SERVICE_ADMISSION_FD = 6 as const;
export const LIBRARY_SERVICE_CREDENTIAL_DESCRIPTOR_FD = 7 as const;
export const LIBRARY_SERVICE_LIFETIME_FD = 8 as const;

export type LibraryServiceRole = "primary";

export const LIBRARY_SERVICE_FAILURE_CODES = Object.freeze([
  "already_started",
  "acl_present",
  "acl_probe_malformed",
  "acl_probe_unavailable",
  "bound_input_changed",
  "config_invalid",
  "config_missing",
  "config_not_private",
  "credential_descriptor_invalid",
  "credential_descriptor_missing",
  "credential_descriptor_not_private",
  "data_root_invalid",
  "data_root_not_private",
  "filesystem_failure",
  "admission_missing",
  "admission_not_private",
  "ready_malformed",
  "ready_binding_mismatch",
  "ready_multiple",
  "ready_oversized",
  "ready_response_lost",
  "ready_role_mismatch",
  "sidecar_digest_mismatch",
  "sidecar_exited",
  "sidecar_invalid",
  "sidecar_missing",
  "sidecar_path_unsafe",
  "sidecar_settlement_timeout",
  "spawn_failed",
  "startup_timeout",
  "startup_cancelled",
  "state_root_invalid",
  "state_root_not_private",
  "status_invalid",
  "status_not_private",
  "unsupported_secret_store_or_acl_backend",
  "unsupported_bound_descriptor_execution",
  "write_failed",
] as const);

export type LibraryServiceFailureCode =
  (typeof LIBRARY_SERVICE_FAILURE_CODES)[number];

export class LibraryServiceFailure extends Error {
  readonly code: LibraryServiceFailureCode;

  constructor(code: LibraryServiceFailureCode) {
    super(code);
    this.name = "LibraryServiceFailure";
    this.code = code;
  }
}

export interface LibraryServiceSidecarConfig {
  executable: string;
  sha256: string;
  startupTimeoutMs: number;
  shutdownTimeoutMs: number;
}

export interface LibraryServiceConfig {
  schemaVersion: typeof LIBRARY_SERVICE_CONFIG_SCHEMA_VERSION;
  role: LibraryServiceRole;
  dataRoot: string;
  stateRoot: string;
  admissionFile: string;
  credentialDescriptorFile: string;
  sidecar: LibraryServiceSidecarConfig;
}

export interface LibraryServiceCredentialDescriptor {
  schemaVersion: 1;
  backend: "os-vault" | "mounted-credential";
  recordId: string;
}

export interface LibraryServiceStartEnvelope {
  type: "start";
  protocolVersion: typeof LIBRARY_SERVICE_PROTOCOL_VERSION;
  role: LibraryServiceRole;
  parentNonce: string;
  configDigest: string;
  executableDigest: string;
  executableFd: typeof LIBRARY_SERVICE_EXECUTABLE_FD;
  dataRootFd: typeof LIBRARY_SERVICE_DATA_ROOT_FD;
  stateRootFd: typeof LIBRARY_SERVICE_STATE_ROOT_FD;
  admissionFd: typeof LIBRARY_SERVICE_ADMISSION_FD;
  credentialDescriptorFd: typeof LIBRARY_SERVICE_CREDENTIAL_DESCRIPTOR_FD;
  lifetimeFd: typeof LIBRARY_SERVICE_LIFETIME_FD;
}

export interface LibraryServiceReadyRecord {
  type: "ready";
  protocolVersion: typeof LIBRARY_SERVICE_PROTOCOL_VERSION;
  role: LibraryServiceRole;
  pid: number;
  leaseHeld: true;
  authorityOpen: true;
  admissionAccepted: true;
  credentialsReady: true;
  watchdogActive: true;
  parentNonce: string;
  configDigest: string;
  executableDigest: string;
  dataRootDevice: string;
  dataRootInode: string;
  stateRootDevice: string;
  stateRootInode: string;
  admissionDigest: string;
  credentialDescriptorDigest: string;
}

export interface LibraryServiceFileMetadata {
  kind: "file" | "directory" | "symbolic-link" | "other";
  mode: number;
  uid: number | null;
  size: number;
  device: string;
  inode: string;
  links: number;
}

export interface LibraryServiceBoundPath {
  readonly path: string;
  readonly descriptor: number;
  readonly metadata: LibraryServiceFileMetadata;
  assertStable(): Promise<void>;
  assertPathStable(): Promise<void>;
  assertCanonicalPath(): Promise<void>;
  readBoundedBytes(maximumBytes: number): Promise<Uint8Array>;
  sha256(): Promise<string>;
  close(): Promise<void>;
}

export interface LibraryServiceFileSystemPort {
  canonicalPath(filePath: string): Promise<string>;
  inspect(filePath: string): Promise<LibraryServiceFileMetadata>;
  openBoundPath(filePath: string): Promise<LibraryServiceBoundPath>;
  openPrivateStatusFile(
    stateRoot: LibraryServiceBoundPath,
    stateRootPath: string,
    expectedUserId: number,
  ): Promise<LibraryServiceBoundPath | null>;
  readPrivateStatusText(
    statusFile: LibraryServiceBoundPath,
    maximumBytes: number,
  ): Promise<string>;
  writePrivateStatusText(
    statusFile: LibraryServiceBoundPath,
    contents: string,
  ): Promise<void>;
}

export interface LibraryServiceAclProbeTarget {
  path: string;
  device: string;
  inode: string;
}

export interface LibraryServiceAclProofPort {
  assertNoExtendedAcl(
    targets: readonly LibraryServiceAclProbeTarget[],
  ): Promise<void>;
}

export interface LibraryServiceIdentityPort {
  currentUserId(): number | null;
}

export interface LibraryServiceClockPort {
  nowMs(): number;
  deadline(milliseconds: number): {
    elapsed: Promise<void>;
    cancel(): void;
  };
}

export interface LibraryServiceEntropyPort {
  nonceHex(byteLength: number): string;
}

export interface LibraryServiceSidecarExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface LibraryServiceSidecarProcess {
  readonly pid: number | null;
  readonly exit: Promise<LibraryServiceSidecarExit>;
  isRunning(): boolean;
  isGroupRunning(): boolean;
  writeControl(contents: string): Promise<void>;
  closeControlInput(): Promise<void>;
  readControlOutput(maximumBytes: number): Promise<Uint8Array>;
  terminate(signal: "SIGTERM" | "SIGKILL"): void;
  closeLifetime(): void;
}

export interface LibraryServiceBoundInputs {
  executable: LibraryServiceBoundPath;
  dataRoot: LibraryServiceBoundPath;
  stateRoot: LibraryServiceBoundPath;
  admission: LibraryServiceBoundPath;
  credentialDescriptor: LibraryServiceBoundPath;
}

export interface LibraryServiceProcessPort {
  spawn(request: {
    bindings: LibraryServiceBoundInputs;
    args: readonly [];
    env: Readonly<Record<string, never>>;
    executableDigest: string;
    settlementTimeoutMs: number;
    signal?: AbortSignal;
  }): Promise<LibraryServiceSidecarProcess>;
}

export type LibraryServicePhase =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export interface LibraryServiceStatusRecord {
  schemaVersion: typeof LIBRARY_SERVICE_STATUS_SCHEMA_VERSION;
  service: "freed-library";
  role: LibraryServiceRole;
  phase: LibraryServicePhase;
  updatedAt: string;
  startedAt: string | null;
  sidecarPid: number | null;
  reasonCode: LibraryServiceFailureCode | "requested_stop" | null;
}

export interface LibraryServiceDoctorReport {
  schemaVersion: 1;
  service: "freed-library";
  ok: boolean;
  role: LibraryServiceRole | null;
  code: "ready" | LibraryServiceFailureCode;
  checks: readonly string[];
}

export interface LibraryServiceStatusReport {
  schemaVersion: 1;
  service: "freed-library";
  configuredRole: LibraryServiceRole;
  status: LibraryServiceStatusRecord | null;
}
