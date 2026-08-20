import { createHash } from "node:crypto";
import path from "node:path";

import {
  LIBRARY_SERVICE_CONFIG_SCHEMA_VERSION,
  LIBRARY_SERVICE_MAX_CONFIG_BYTES,
  LIBRARY_SERVICE_MAX_DESCRIPTOR_BYTES,
  LibraryServiceFailure,
  type LibraryServiceAclProbeTarget,
  type LibraryServiceAclProofPort,
  type LibraryServiceBoundInputs,
  type LibraryServiceBoundPath,
  type LibraryServiceConfig,
  type LibraryServiceCredentialDescriptor,
  type LibraryServiceFailureCode,
  type LibraryServiceFileMetadata,
  type LibraryServiceFileSystemPort,
  type LibraryServiceIdentityPort,
} from "./contracts.js";

const CONFIG_KEYS = new Set([
  "schemaVersion",
  "role",
  "dataRoot",
  "stateRoot",
  "admissionFile",
  "credentialDescriptorFile",
  "sidecar",
]);
const SIDECAR_KEYS = new Set([
  "executable",
  "sha256",
  "startupTimeoutMs",
  "shutdownTimeoutMs",
]);
const CREDENTIAL_DESCRIPTOR_KEYS = new Set([
  "schemaVersion",
  "backend",
  "recordId",
]);
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const SAFE_RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ASCII_CONTROL = /[\x00-\x1f\x7f]/;
const MIN_TIMEOUT_MS = 100;
const MAX_STARTUP_TIMEOUT_MS = 30_000;
const MAX_SHUTDOWN_TIMEOUT_MS = 10_000;
const MAX_ADMISSION_BYTES = 64 * 1_024;

interface ValidationContext {
  fileSystem: LibraryServiceFileSystemPort;
  userId: number;
  signal?: AbortSignal;
  aclTargets: Map<string, LibraryServiceAclProbeTarget>;
}

export interface BoundLibraryServiceConfiguration {
  config: LibraryServiceConfig;
  configDigest: string;
  executableDigest: string;
  admissionDigest: string;
  credentialDescriptorDigest: string;
  configFile: LibraryServiceBoundPath;
  bindings: LibraryServiceBoundInputs;
  close(): Promise<void>;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new LibraryServiceFailure("startup_cancelled");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: Set<string>,
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function isBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function requireAbsolutePhysicalPath(
  value: unknown,
  failureCode: LibraryServiceFailureCode,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4_096 ||
    ASCII_CONTROL.test(value) ||
    !path.isAbsolute(value) ||
    path.resolve(value) !== value
  ) {
    throw new LibraryServiceFailure(failureCode);
  }
  return value;
}

function pathComponents(filePath: string): string[] {
  const parsed = path.parse(filePath);
  const relative = filePath.slice(parsed.root.length);
  const components = relative.split(path.sep).filter(Boolean);
  const result = [parsed.root];
  let current = parsed.root;
  for (const component of components) {
    current = path.join(current, component);
    result.push(current);
  }
  return result;
}

function sameIdentity(
  left: LibraryServiceFileMetadata,
  right: LibraryServiceFileMetadata,
): boolean {
  return (
    left.kind === right.kind &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    (left.kind !== "file" || left.size === right.size) &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.links === right.links
  );
}

async function inspect(
  filePath: string,
  context: ValidationContext,
  failureCode: LibraryServiceFailureCode,
): Promise<LibraryServiceFileMetadata> {
  throwIfAborted(context.signal);
  try {
    const metadata = await context.fileSystem.inspect(filePath);
    throwIfAborted(context.signal);
    return metadata;
  } catch (error) {
    if (error instanceof LibraryServiceFailure) throw error;
    throw new LibraryServiceFailure(failureCode);
  }
}

async function requireCanonicalPath(
  filePath: string,
  context: ValidationContext,
  failureCode: LibraryServiceFailureCode,
): Promise<void> {
  throwIfAborted(context.signal);
  let canonical: string;
  try {
    canonical = await context.fileSystem.canonicalPath(filePath);
  } catch {
    throw new LibraryServiceFailure(failureCode);
  }
  throwIfAborted(context.signal);
  if (canonical !== filePath) {
    throw new LibraryServiceFailure(failureCode);
  }
}

function addAclTarget(
  context: ValidationContext,
  filePath: string,
  metadata: LibraryServiceFileMetadata,
): void {
  context.aclTargets.set(filePath, {
    path: filePath,
    device: metadata.device,
    inode: metadata.inode,
  });
}

async function requireSafeHierarchy(
  filePath: string,
  context: ValidationContext,
  failureCode: LibraryServiceFailureCode,
  rootOwned = false,
): Promise<void> {
  for (const component of pathComponents(path.dirname(filePath))) {
    const metadata = await inspect(component, context, failureCode);
    if (
      metadata.kind !== "directory" ||
      (rootOwned
        ? metadata.uid !== 0
        : metadata.uid !== 0 && metadata.uid !== context.userId) ||
      (metadata.mode & 0o022) !== 0
    ) {
      throw new LibraryServiceFailure(failureCode);
    }
    addAclTarget(context, component, metadata);
  }
}

async function openVerifiedPath(
  filePath: string,
  context: ValidationContext,
  preOpen: LibraryServiceFileMetadata,
  failureCode: LibraryServiceFailureCode,
): Promise<LibraryServiceBoundPath> {
  throwIfAborted(context.signal);
  let bound: LibraryServiceBoundPath;
  try {
    bound = await context.fileSystem.openBoundPath(filePath);
  } catch {
    throw new LibraryServiceFailure(failureCode);
  }
  try {
    throwIfAborted(context.signal);
    if (!sameIdentity(preOpen, bound.metadata)) {
      throw new LibraryServiceFailure("bound_input_changed");
    }
    addAclTarget(context, filePath, bound.metadata);
    return bound;
  } catch (error) {
    await bound.close().catch(() => undefined);
    throw error;
  }
}

async function bindPrivateFile(
  filePath: string,
  context: ValidationContext,
  missingCode: LibraryServiceFailureCode,
  privateCode: LibraryServiceFailureCode,
): Promise<LibraryServiceBoundPath> {
  const metadata = await inspect(filePath, context, missingCode);
  if (
    metadata.kind !== "file" ||
    metadata.uid !== context.userId ||
    (metadata.mode & 0o7777) !== 0o600 ||
    metadata.links !== 1
  ) {
    throw new LibraryServiceFailure(privateCode);
  }
  await requireCanonicalPath(filePath, context, privateCode);
  await requireSafeHierarchy(filePath, context, privateCode);
  return openVerifiedPath(filePath, context, metadata, privateCode);
}

async function bindPrivateDirectory(
  directoryPath: string,
  context: ValidationContext,
  invalidCode: LibraryServiceFailureCode,
  privateCode: LibraryServiceFailureCode,
): Promise<LibraryServiceBoundPath> {
  const metadata = await inspect(directoryPath, context, invalidCode);
  if (metadata.kind !== "directory") {
    throw new LibraryServiceFailure(invalidCode);
  }
  if (metadata.uid !== context.userId || (metadata.mode & 0o7777) !== 0o700) {
    throw new LibraryServiceFailure(privateCode);
  }
  await requireCanonicalPath(directoryPath, context, privateCode);
  await requireSafeHierarchy(directoryPath, context, privateCode);
  return openVerifiedPath(directoryPath, context, metadata, privateCode);
}

async function bindPinnedSidecar(
  config: LibraryServiceConfig,
  context: ValidationContext,
): Promise<{ bound: LibraryServiceBoundPath; digest: string }> {
  const executable = config.sidecar.executable;
  const metadata = await inspect(executable, context, "sidecar_missing");
  if (metadata.kind === "symbolic-link") {
    throw new LibraryServiceFailure("sidecar_path_unsafe");
  }
  if (
    metadata.kind !== "file" ||
    metadata.uid !== 0 ||
    (metadata.mode & 0o7000) !== 0 ||
    (metadata.mode & 0o022) !== 0 ||
    (metadata.mode & 0o111) === 0 ||
    metadata.links !== 1
  ) {
    throw new LibraryServiceFailure("sidecar_invalid");
  }
  await requireCanonicalPath(executable, context, "sidecar_path_unsafe");
  await requireSafeHierarchy(executable, context, "sidecar_path_unsafe", true);
  const bound = await openVerifiedPath(
    executable,
    context,
    metadata,
    "sidecar_invalid",
  );
  try {
    const digest = await bound.sha256();
    throwIfAborted(context.signal);
    if (digest !== config.sidecar.sha256) {
      throw new LibraryServiceFailure("sidecar_digest_mismatch");
    }
    return { bound, digest };
  } catch (error) {
    await bound.close().catch(() => undefined);
    throw error;
  }
}

function parseConfig(text: string): LibraryServiceConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LibraryServiceFailure("config_invalid");
  }
  if (!isObject(raw) || !hasExactKeys(raw, CONFIG_KEYS)) {
    throw new LibraryServiceFailure("config_invalid");
  }
  if (
    raw.schemaVersion !== LIBRARY_SERVICE_CONFIG_SCHEMA_VERSION ||
    raw.role !== "primary" ||
    !isObject(raw.sidecar) ||
    !hasExactKeys(raw.sidecar, SIDECAR_KEYS)
  ) {
    throw new LibraryServiceFailure("config_invalid");
  }

  const dataRoot = requireAbsolutePhysicalPath(
    raw.dataRoot,
    "data_root_invalid",
  );
  const stateRoot = requireAbsolutePhysicalPath(
    raw.stateRoot,
    "state_root_invalid",
  );
  const admissionFile = requireAbsolutePhysicalPath(
    raw.admissionFile,
    "admission_missing",
  );
  const credentialDescriptorFile = requireAbsolutePhysicalPath(
    raw.credentialDescriptorFile,
    "credential_descriptor_missing",
  );
  const executable = requireAbsolutePhysicalPath(
    raw.sidecar.executable,
    "sidecar_invalid",
  );

  if (
    typeof raw.sidecar.sha256 !== "string" ||
    !LOWERCASE_SHA256.test(raw.sidecar.sha256) ||
    !isBoundedInteger(
      raw.sidecar.startupTimeoutMs,
      MIN_TIMEOUT_MS,
      MAX_STARTUP_TIMEOUT_MS,
    ) ||
    !isBoundedInteger(
      raw.sidecar.shutdownTimeoutMs,
      MIN_TIMEOUT_MS,
      MAX_SHUTDOWN_TIMEOUT_MS,
    )
  ) {
    throw new LibraryServiceFailure("config_invalid");
  }

  return {
    schemaVersion: LIBRARY_SERVICE_CONFIG_SCHEMA_VERSION,
    role: "primary",
    dataRoot,
    stateRoot,
    admissionFile,
    credentialDescriptorFile,
    sidecar: {
      executable,
      sha256: raw.sidecar.sha256,
      startupTimeoutMs: raw.sidecar.startupTimeoutMs,
      shutdownTimeoutMs: raw.sidecar.shutdownTimeoutMs,
    },
  };
}

function parseCredentialDescriptor(
  text: string,
): LibraryServiceCredentialDescriptor {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LibraryServiceFailure("credential_descriptor_invalid");
  }
  if (
    !isObject(raw) ||
    !hasExactKeys(raw, CREDENTIAL_DESCRIPTOR_KEYS) ||
    raw.schemaVersion !== 1 ||
    (raw.backend !== "os-vault" && raw.backend !== "mounted-credential") ||
    typeof raw.recordId !== "string" ||
    !SAFE_RECORD_ID.test(raw.recordId)
  ) {
    throw new LibraryServiceFailure("credential_descriptor_invalid");
  }
  return {
    schemaVersion: 1,
    backend: raw.backend,
    recordId: raw.recordId,
  };
}

function isWithinOrEqual(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function isStrictChild(candidate: string, parent: string): boolean {
  return candidate !== parent && isWithinOrEqual(candidate, parent);
}

function validatePathSeparation(
  configPath: string,
  config: LibraryServiceConfig,
): void {
  const statusPath = path.join(config.stateRoot, "library-service-status.json");
  if (
    config.dataRoot === config.stateRoot ||
    isWithinOrEqual(config.dataRoot, config.stateRoot) ||
    isWithinOrEqual(config.stateRoot, config.dataRoot) ||
    isWithinOrEqual(configPath, config.dataRoot) ||
    isWithinOrEqual(configPath, config.stateRoot) ||
    isWithinOrEqual(config.sidecar.executable, config.dataRoot) ||
    isWithinOrEqual(config.sidecar.executable, config.stateRoot) ||
    isWithinOrEqual(config.admissionFile, config.dataRoot) ||
    isWithinOrEqual(config.credentialDescriptorFile, config.dataRoot) ||
    !isStrictChild(config.admissionFile, config.stateRoot) ||
    !isStrictChild(config.credentialDescriptorFile, config.stateRoot) ||
    config.admissionFile === config.credentialDescriptorFile ||
    config.admissionFile === statusPath ||
    config.credentialDescriptorFile === statusPath
  ) {
    throw new LibraryServiceFailure("config_invalid");
  }
}

function decodeBoundedText(
  bytes: Uint8Array,
  failureCode: LibraryServiceFailureCode,
): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LibraryServiceFailure(failureCode);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function closeBoundPaths(
  paths: readonly LibraryServiceBoundPath[],
): Promise<void> {
  await Promise.all(paths.map((bound) => bound.close().catch(() => undefined)));
}

export async function assertLibraryServiceBindingsStable(
  bound: BoundLibraryServiceConfiguration,
  fileSystem: LibraryServiceFileSystemPort,
  signal?: AbortSignal,
): Promise<void> {
  const paths = [bound.configFile, ...Object.values(bound.bindings)];
  for (const resource of paths) {
    throwIfAborted(signal);
    try {
      await resource.assertStable();
      await resource.assertPathStable();
      await resource.assertCanonicalPath();
    } catch {
      throwIfAborted(signal);
      throw new LibraryServiceFailure("bound_input_changed");
    }
    throwIfAborted(signal);
    let current: LibraryServiceFileMetadata;
    try {
      current = await fileSystem.inspect(resource.path);
    } catch {
      throw new LibraryServiceFailure("bound_input_changed");
    }
    throwIfAborted(signal);
    if (!sameIdentity(current, resource.metadata)) {
      throw new LibraryServiceFailure("bound_input_changed");
    }
  }

  const digests: ReadonlyArray<readonly [LibraryServiceBoundPath, string]> = [
    [bound.configFile, bound.configDigest],
    [bound.bindings.executable, bound.executableDigest],
    [bound.bindings.admission, bound.admissionDigest],
    [bound.bindings.credentialDescriptor, bound.credentialDescriptorDigest],
  ];
  for (const [resource, expectedDigest] of digests) {
    throwIfAborted(signal);
    let actualDigest: string;
    try {
      actualDigest = await resource.sha256();
    } catch {
      throwIfAborted(signal);
      throw new LibraryServiceFailure("bound_input_changed");
    }
    throwIfAborted(signal);
    if (actualDigest !== expectedDigest) {
      throw new LibraryServiceFailure("bound_input_changed");
    }
  }
}

export async function bindLibraryServiceConfig(
  configPath: string,
  fileSystem: LibraryServiceFileSystemPort,
  identity: LibraryServiceIdentityPort,
  aclProof: LibraryServiceAclProofPort,
  signal?: AbortSignal,
): Promise<BoundLibraryServiceConfiguration> {
  const userId = identity.currentUserId();
  if (userId === null) {
    throw new LibraryServiceFailure("unsupported_secret_store_or_acl_backend");
  }
  throwIfAborted(signal);
  const physicalConfigPath = requireAbsolutePhysicalPath(
    configPath,
    "config_missing",
  );
  const context: ValidationContext = {
    fileSystem,
    userId,
    signal,
    aclTargets: new Map(),
  };
  const opened: LibraryServiceBoundPath[] = [];

  try {
    const configFile = await bindPrivateFile(
      physicalConfigPath,
      context,
      "config_missing",
      "config_not_private",
    );
    opened.push(configFile);
    const configBytes = await configFile.readBoundedBytes(
      LIBRARY_SERVICE_MAX_CONFIG_BYTES,
    );
    throwIfAborted(signal);
    const configDigest = sha256(configBytes);
    const config = parseConfig(
      decodeBoundedText(configBytes, "config_invalid"),
    );
    validatePathSeparation(physicalConfigPath, config);

    const dataRoot = await bindPrivateDirectory(
      config.dataRoot,
      context,
      "data_root_invalid",
      "data_root_not_private",
    );
    opened.push(dataRoot);
    const stateRoot = await bindPrivateDirectory(
      config.stateRoot,
      context,
      "state_root_invalid",
      "state_root_not_private",
    );
    opened.push(stateRoot);
    const admission = await bindPrivateFile(
      config.admissionFile,
      context,
      "admission_missing",
      "admission_not_private",
    );
    opened.push(admission);
    if (admission.metadata.size > MAX_ADMISSION_BYTES) {
      throw new LibraryServiceFailure("admission_not_private");
    }
    const credentialDescriptor = await bindPrivateFile(
      config.credentialDescriptorFile,
      context,
      "credential_descriptor_missing",
      "credential_descriptor_not_private",
    );
    opened.push(credentialDescriptor);
    const credentialBytes = await credentialDescriptor.readBoundedBytes(
      LIBRARY_SERVICE_MAX_DESCRIPTOR_BYTES,
    );
    throwIfAborted(signal);
    parseCredentialDescriptor(
      decodeBoundedText(credentialBytes, "credential_descriptor_invalid"),
    );
    const sidecar = await bindPinnedSidecar(config, context);
    opened.push(sidecar.bound);

    throwIfAborted(signal);
    try {
      await aclProof.assertNoExtendedAcl([...context.aclTargets.values()]);
    } catch (error) {
      if (error instanceof LibraryServiceFailure) throw error;
      throw new LibraryServiceFailure("acl_probe_unavailable");
    }
    throwIfAborted(signal);

    const result: BoundLibraryServiceConfiguration = {
      config,
      configDigest,
      executableDigest: sidecar.digest,
      admissionDigest: await admission.sha256(),
      credentialDescriptorDigest: sha256(credentialBytes),
      configFile,
      bindings: {
        executable: sidecar.bound,
        dataRoot,
        stateRoot,
        admission,
        credentialDescriptor,
      },
      async close() {
        await closeBoundPaths([
          configFile,
          sidecar.bound,
          dataRoot,
          stateRoot,
          admission,
          credentialDescriptor,
        ]);
      },
    };
    await assertLibraryServiceBindingsStable(result, fileSystem, signal);
    return result;
  } catch (error) {
    await closeBoundPaths(opened);
    throw error;
  }
}
