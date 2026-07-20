#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RELEASE_TAG_PUBLISHER_APP_ID as RELEASE_GITHUB_APP_ID,
  RELEASE_TAG_PUBLISHER_APP_SLUG as RELEASE_GITHUB_APP_SLUG,
  RELEASE_TAG_PUBLISHER_BINDING_PURPOSE,
  RELEASE_TAG_PUBLISHER_BINDING_SCHEMA_VERSION,
  RELEASE_TAG_PUBLISHER_REPO,
  releaseTagPublisherNativePairSha256,
  verifyReleaseTagPublisherBindingShape,
} from "./lib/release-tag-publisher-binding.mjs";
import { verifyReleaseTagPublisherReadiness } from "./lib/release-tag-publisher.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

export const RELEASE_TAG_PUBLISHER_DIRECTORY =
  "/Library/Application Support/Freed";
export const RELEASE_TAG_PUBLISHER_HOST = path.join(
  RELEASE_TAG_PUBLISHER_DIRECTORY,
  "release-tag-publisher",
);
export const RELEASE_TAG_PUBLISHER_PROVISIONER = path.join(
  RELEASE_TAG_PUBLISHER_DIRECTORY,
  "release-tag-publisher-provision",
);
export const RELEASE_TAG_PUBLISHER_CONFIG = path.join(
  RELEASE_TAG_PUBLISHER_DIRECTORY,
  "release-tag-publisher.json",
);
const RELEASE_TAG_PUBLISHER_KEYCHAIN_SERVICE = "freed-release-tag-publisher";
const RELEASE_TAG_PUBLISHER_KEYCHAIN_ACCOUNT = "github-app-private-key";
const MAXIMUM_PRIVATE_KEY_BYTES = 32 * 1_024;
const MAXIMUM_BINDING_BYTES = 64 * 1_024;
const DARWIN_O_CLOEXEC = 0x01000000;

class InstallerError extends Error {}

function fail(message) {
  throw new InstallerError(message);
}

function defaultDependencies() {
  return {
    repoRoot: REPO_ROOT,
    tempRoot: os.tmpdir(),
    buildScript: path.join(
      REPO_ROOT,
      "scripts",
      "release-tag-publisher-build.sh",
    ),
    hostPath: RELEASE_TAG_PUBLISHER_HOST,
    provisionerPath: RELEASE_TAG_PUBLISHER_PROVISIONER,
    configPath: RELEASE_TAG_PUBLISHER_CONFIG,
    run: spawnSync,
    readInstalledConfig: inspectInstalledConfig,
    authorizeRecovery() {
      fail(
        "Release Publisher credential mutation is unavailable until one-use kernel-attested owner authorization and staged GitHub identity proof are integrated.",
      );
    },
  };
}

function dependenciesWith(overrides = {}) {
  return { ...defaultDependencies(), ...overrides };
}

function runChecked(dependencies, executable, args, options = {}) {
  const result = dependencies.run(executable, args, {
    cwd: options.cwd ?? dependencies.repoRoot,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio,
    input: options.input,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
    env: {
      HOME: process.env.HOME ?? "",
      PATH: "/usr/bin:/bin",
    },
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr ?? "").trim();
    fail(
      `${options.purpose ?? executable} failed${detail ? `: ${detail}` : "."}`,
    );
  }
  return String(result.stdout ?? "").trim();
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function inspectInstalledHost(filePath) {
  if (!path.isAbsolute(filePath) || realpathSync(filePath) !== filePath) {
    fail("The installed publisher host must use a canonical absolute path.");
  }
  const link = lstatSync(filePath);
  const metadata = statSync(filePath);
  if (
    link.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.uid !== 0 ||
    (metadata.mode & 0o022) !== 0 ||
    (metadata.mode & 0o111) === 0
  ) {
    fail(
      "The installed publisher host is not a root-owned immutable executable.",
    );
  }
  return filePath;
}

function inspectInstalledConfig(filePath) {
  let descriptor;
  let bytes;
  try {
    if (!path.isAbsolute(filePath) || realpathSync(filePath) !== filePath) {
      fail(
        "The installed publisher binding must use a canonical absolute path.",
      );
    }
    const link = lstatSync(filePath, { bigint: true });
    descriptor = openSync(
      filePath,
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        (constants.O_CLOEXEC ?? DARWIN_O_CLOEXEC),
    );
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !link.isFile() ||
      !before.isFile() ||
      link.dev !== before.dev ||
      link.ino !== before.ino ||
      before.uid !== 0n ||
      before.gid !== 0n ||
      before.nlink !== 1n ||
      (before.mode & 0o777n) !== 0o444n ||
      before.size <= 0n ||
      before.size > BigInt(MAXIMUM_BINDING_BYTES)
    ) {
      fail("The installed publisher binding is not an exact root-owned file.");
    }
    const expectedSize = Number(before.size);
    bytes = Buffer.alloc(expectedSize + 1);
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
    const after = fstatSync(descriptor, { bigint: true });
    if (
      offset !== expectedSize ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mode !== after.mode ||
      before.uid !== after.uid ||
      before.gid !== after.gid ||
      before.nlink !== after.nlink ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      fail("The installed publisher binding changed during admission.");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, expectedSize),
    );
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof InstallerError) throw error;
    fail("The installed publisher binding could not be admitted safely.");
  } finally {
    bytes?.fill(0);
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function withPrivateDirectory(dependencies, operation) {
  const created = mkdtempSync(
    path.join(dependencies.tempRoot, "freed-release-tag-publisher-"),
  );
  const directory = realpathSync(created);
  chmodSync(directory, 0o700);
  try {
    return operation(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function sudoInstall(dependencies, args, purpose) {
  runChecked(dependencies, "/usr/bin/sudo", ["/usr/bin/install", ...args], {
    purpose,
  });
}

function nativePairBinding(
  dependencies,
  { status, publisherSha256, provisionerSha256 },
) {
  const binding = {
    schemaVersion: RELEASE_TAG_PUBLISHER_BINDING_SCHEMA_VERSION,
    purpose: RELEASE_TAG_PUBLISHER_BINDING_PURPOSE,
    status,
    repo: RELEASE_TAG_PUBLISHER_REPO,
    appId: RELEASE_GITHUB_APP_ID,
    appSlug: RELEASE_GITHUB_APP_SLUG,
    publisherPath: dependencies.hostPath,
    publisherSha256,
    provisionerPath: dependencies.provisionerPath,
    provisionerSha256,
  };
  return {
    ...binding,
    nativePairSha256: releaseTagPublisherNativePairSha256(binding),
  };
}

function installBinding(dependencies, directory, binding, purpose) {
  const source = path.join(
    directory,
    `release-tag-publisher.${binding.status}.json`,
  );
  writeFileSync(source, `${JSON.stringify(binding, null, 2)}\n`, {
    mode: 0o600,
  });
  sudoInstall(
    dependencies,
    [
      "-o",
      "root",
      "-g",
      "wheel",
      "-m",
      "0444",
      source,
      dependencies.configPath,
    ],
    purpose,
  );
}

export function prepareReleaseTagPublisher({ dependencies: overrides } = {}) {
  const dependencies = dependenciesWith(overrides);
  return withPrivateDirectory(dependencies, (directory) => {
    const hostOutput = path.join(directory, "release-tag-publisher");
    const provisionerOutput = path.join(
      directory,
      "release-tag-publisher-provision",
    );
    runChecked(
      dependencies,
      "/bin/bash",
      [
        dependencies.buildScript,
        "--host-output",
        hostOutput,
        "--provisioner-output",
        provisionerOutput,
      ],
      { purpose: "Release tag publisher native build" },
    );
    const publisherSha256 = sha256File(hostOutput);
    const provisionerSha256 = sha256File(provisionerOutput);
    sudoInstall(
      dependencies,
      [
        "-d",
        "-o",
        "root",
        "-g",
        "wheel",
        "-m",
        "0755",
        path.dirname(dependencies.hostPath),
      ],
      "Release tag publisher directory installation",
    );
    const preparingBinding = nativePairBinding(dependencies, {
      status: "preparing",
      publisherSha256,
      provisionerSha256,
    });
    installBinding(
      dependencies,
      directory,
      preparingBinding,
      "Release tag publisher fail-closed native cutover binding installation",
    );
    sudoInstall(
      dependencies,
      [
        "-o",
        "root",
        "-g",
        "wheel",
        "-m",
        "0555",
        provisionerOutput,
        dependencies.provisionerPath,
      ],
      "Release tag publisher lockdown provisioner installation",
    );
    if (sha256File(dependencies.provisionerPath) !== provisionerSha256) {
      fail(
        "The installed lockdown provisioner digest does not match its build.",
      );
    }
    sudoInstall(
      dependencies,
      [
        "-o",
        "root",
        "-g",
        "wheel",
        "-m",
        "0555",
        hostOutput,
        dependencies.hostPath,
      ],
      "Release tag publisher host installation",
    );
    if (
      sha256File(dependencies.hostPath) !== publisherSha256 ||
      sha256File(dependencies.provisionerPath) !== provisionerSha256
    ) {
      fail(
        "The installed release publisher native pair is mixed or incomplete.",
      );
    }
    const preparedBinding = {
      ...preparingBinding,
      status: "prepared",
    };
    installBinding(
      dependencies,
      directory,
      preparedBinding,
      "Release tag publisher prepared native pair binding installation",
    );
    return {
      action: "prepare",
      hostPath: dependencies.hostPath,
      provisionerPath: dependencies.provisionerPath,
      publisherSha256,
      provisionerSha256,
      nativePairSha256: preparedBinding.nativePairSha256,
    };
  });
}

function loadInstalledBinding(dependencies, statuses) {
  const binding = dependencies.readInstalledConfig(dependencies.configPath);
  verifyReleaseTagPublisherBindingShape(binding, { statuses });
  if (
    binding.publisherPath !== dependencies.hostPath ||
    binding.provisionerPath !== dependencies.provisionerPath
  ) {
    fail(
      "The installed publisher binding does not use the fixed native paths.",
    );
  }
  return binding;
}

function verifyInstalledNativePair(dependencies, binding) {
  requireInstalledExecutable(dependencies, binding.publisherPath);
  requireInstalledExecutable(dependencies, binding.provisionerPath);
  const publisherSha256 = sha256File(binding.publisherPath);
  const provisionerSha256 = sha256File(binding.provisionerPath);
  if (
    publisherSha256 !== binding.publisherSha256 ||
    provisionerSha256 !== binding.provisionerSha256
  ) {
    fail("The installed release publisher native pair is mixed or incomplete.");
  }
  return { publisherSha256, provisionerSha256 };
}

function requireBoundNativePair(dependencies, statuses = ["active"]) {
  if (typeof dependencies.verifyInstalledNativePair === "function") {
    return dependencies.verifyInstalledNativePair({ statuses });
  }
  const binding = loadInstalledBinding(dependencies, statuses);
  verifyInstalledNativePair(dependencies, binding);
  return binding;
}

function validateAppIdentity(appId, appSlug) {
  const numericId = Number(appId);
  if (numericId !== RELEASE_GITHUB_APP_ID) {
    fail("The release GitHub App ID must match the dedicated publisher App.");
  }
  if (appSlug !== RELEASE_GITHUB_APP_SLUG) {
    fail("The release GitHub App slug must match the dedicated publisher App.");
  }
  return { appId: numericId, appSlug };
}

export function activateReleaseTagPublisher({
  appId,
  appSlug,
  dependencies: overrides,
}) {
  const dependencies = dependenciesWith(overrides);
  const identity = validateAppIdentity(appId, appSlug);
  dependencies.authorizeRecovery({
    action: "release-tag-publisher.activate-existing-credential",
    appId: identity.appId,
    appSlug: identity.appSlug,
    repo: "freed-project/freed",
  });
  const prepared = loadInstalledBinding(dependencies, ["prepared", "active"]);
  verifyInstalledNativePair(dependencies, prepared);
  const recovered = prepared.status === "active";
  const binding = recovered ? prepared : { ...prepared, status: "active" };
  if (!recovered) {
    withPrivateDirectory(dependencies, (directory) => {
      installBinding(
        dependencies,
        directory,
        binding,
        "Release tag publisher active native pair binding installation",
      );
    });
  }
  const attestation = JSON.parse(
    runChecked(
      dependencies,
      dependencies.hostPath,
      [
        "attest",
        "--repo",
        binding.repo,
        "--app-id",
        String(binding.appId),
        "--app-slug",
        binding.appSlug,
      ],
      { purpose: "Release tag publisher local attestation" },
    ),
  );
  verifyReleaseTagPublisherReadiness(attestation, {
    repo: binding.repo,
    releaseAppId: binding.appId,
    releaseAppSlug: binding.appSlug,
    publisherDigest: binding.publisherSha256,
    provisionerDigest: binding.provisionerSha256,
    nativePairDigest: binding.nativePairSha256,
  });
  return {
    action: "activate",
    recovered,
    binding,
    attestation,
  };
}

function privateKeyMetadataIdentity(metadata) {
  return [
    metadata.dev,
    metadata.ino,
    metadata.mode,
    metadata.uid,
    metadata.gid,
    metadata.nlink,
    metadata.size,
    metadata.mtimeNs,
    metadata.ctimeNs,
  ].join(":");
}

function validatePrivateKeyMetadata(metadata) {
  const currentUser = process.getuid?.();
  if (
    !metadata.isFile() ||
    !Number.isSafeInteger(currentUser) ||
    metadata.uid !== BigInt(currentUser) ||
    (metadata.mode & 0o777n) !== 0o600n ||
    metadata.nlink !== 1n ||
    metadata.size <= 0n ||
    metadata.size > BigInt(MAXIMUM_PRIVATE_KEY_BYTES)
  ) {
    fail(
      "The private key file must be one current-user-owned mode 0600 regular file with exactly one link and a bounded size.",
    );
  }
}

function validatePrivateKeyPathIdentity(filePath, descriptorMetadata) {
  if (!path.isAbsolute(filePath) || realpathSync(filePath) !== filePath) {
    fail("The private key file must use a canonical absolute path.");
  }
  const link = lstatSync(filePath, { bigint: true });
  if (
    link.isSymbolicLink() ||
    link.dev !== descriptorMetadata.dev ||
    link.ino !== descriptorMetadata.ino
  ) {
    fail("The private key path changed while it was being admitted.");
  }
}

function admitPrivateKeyFile(filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    fail("The private key file must use a canonical absolute path.");
  }
  let descriptor;
  let bytes;
  let overflow;
  try {
    descriptor = openSync(
      filePath,
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        (constants.O_CLOEXEC ?? DARWIN_O_CLOEXEC),
    );
    const initial = fstatSync(descriptor, { bigint: true });
    validatePrivateKeyMetadata(initial);
    validatePrivateKeyPathIdentity(filePath, initial);
    bytes = Buffer.alloc(Number(initial.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (count === 0) {
        fail("The private key file changed while it was being read.");
      }
      offset += count;
    }
    overflow = Buffer.alloc(1);
    if (readSync(descriptor, overflow, 0, 1, bytes.length) !== 0) {
      fail("The private key file grew while it was being read.");
    }
    overflow.fill(0);
    overflow = undefined;
    const admittedIdentity = privateKeyMetadataIdentity(initial);
    const assertUnchanged = () => {
      const current = fstatSync(descriptor, { bigint: true });
      validatePrivateKeyMetadata(current);
      validatePrivateKeyPathIdentity(filePath, current);
      if (privateKeyMetadataIdentity(current) !== admittedIdentity) {
        fail("The private key file changed after admission.");
      }
    };
    assertUnchanged();
    const digest = createHash("sha256").update(bytes).digest("hex");
    bytes.fill(0);
    bytes = undefined;
    return { descriptor, digest, assertUnchanged };
  } catch (error) {
    bytes?.fill(0);
    overflow?.fill(0);
    if (descriptor !== undefined) closeSync(descriptor);
    if (error instanceof InstallerError) throw error;
    fail("The private key file could not be admitted safely.");
  }
}

function withAdmittedPrivateKey(filePath, operation) {
  const admission = admitPrivateKeyFile(filePath);
  try {
    return operation(admission);
  } finally {
    closeSync(admission.descriptor);
  }
}

function inspectKeychainPresence(dependencies) {
  if (typeof dependencies.keychainPresence === "function") {
    const presence = dependencies.keychainPresence();
    if (!["missing", "present"].includes(presence)) {
      fail("The injected publisher Keychain presence result is invalid.");
    }
    return presence;
  }
  const result = dependencies.run(
    "/usr/bin/security",
    [
      "find-generic-password",
      "-s",
      RELEASE_TAG_PUBLISHER_KEYCHAIN_SERVICE,
      "-a",
      RELEASE_TAG_PUBLISHER_KEYCHAIN_ACCOUNT,
    ],
    {
      cwd: dependencies.repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        HOME: process.env.HOME ?? "",
        PATH: "/usr/bin:/bin",
      },
    },
  );
  if (!result.error && result.status === 0) return "present";
  if (!result.error && result.status === 44) return "missing";
  fail("The release publisher Keychain item could not be inspected safely.");
}

function requireInstalledExecutable(dependencies, filePath) {
  const inspect = dependencies.inspectInstalledHost ?? inspectInstalledHost;
  return inspect(filePath);
}

function invokeProvisioner(
  dependencies,
  action,
  { descriptor = null, expectedSha256 = null } = {},
) {
  const args = [action, "--host", dependencies.hostPath];
  if (expectedSha256 !== null) {
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
      fail("The expected release App key digest is invalid.");
    }
    args.push("--expected-sha256", expectedSha256);
  }
  const output = runChecked(dependencies, dependencies.provisionerPath, args, {
    purpose: `Release tag publisher key ${action}`,
    stdio: [descriptor ?? "ignore", "pipe", "pipe"],
  });
  try {
    const result = JSON.parse(output);
    if (
      result?.schemaVersion !== 1 ||
      result?.purpose !== "freed-release-tag-publisher-keychain-result" ||
      result?.action !== action
    ) {
      fail("The publisher provisioner returned an invalid result envelope.");
    }
    return result;
  } catch (error) {
    if (error instanceof InstallerError) throw error;
    fail("The publisher provisioner returned invalid JSON.");
  }
}

export function provisionReleaseTagPublisher({
  appId,
  appSlug,
  privateKeyFile,
  dependencies: overrides,
}) {
  const dependencies = dependenciesWith(overrides);
  const identity = validateAppIdentity(appId, appSlug);
  return withAdmittedPrivateKey(privateKeyFile, (admission) => {
    dependencies.authorizeRecovery({
      action: "release-tag-publisher.recover-existing-app",
      appId: identity.appId,
      appSlug: identity.appSlug,
      privateKeySha256: admission.digest,
    });
    admission.assertUnchanged();
    const presence = inspectKeychainPresence(dependencies);
    admission.assertUnchanged();
    let prepared = null;
    let credentialAction = "resumed";
    if (presence === "missing") {
      prepared =
        typeof dependencies.prepareReleaseTagPublisher === "function"
          ? dependencies.prepareReleaseTagPublisher()
          : prepareReleaseTagPublisher({ dependencies });
      admission.assertUnchanged();
      invokeProvisioner(dependencies, "recover", {
        descriptor: admission.descriptor,
        expectedSha256: admission.digest,
      });
      admission.assertUnchanged();
      credentialAction = "recovered";
    } else {
      requireBoundNativePair(dependencies);
    }
    admission.assertUnchanged();
    invokeProvisioner(dependencies, "matches", {
      expectedSha256: admission.digest,
    });
    admission.assertUnchanged();
    const activated =
      typeof dependencies.activateReleaseTagPublisher === "function"
        ? dependencies.activateReleaseTagPublisher(identity)
        : activateReleaseTagPublisher({
            ...identity,
            dependencies,
          });
    return {
      action: "provision",
      credentialAction,
      prepared,
      activated,
    };
  });
}

export function verifyReleaseTagPublisher({ dependencies: overrides } = {}) {
  const dependencies = dependenciesWith(overrides);
  const binding = requireBoundNativePair(dependencies);
  invokeProvisioner(dependencies, "verify");
  const readiness = runChecked(
    dependencies,
    dependencies.hostPath,
    [
      "verify-installation",
      "--repo",
      binding.repo,
      "--app-id",
      String(binding.appId),
      "--app-slug",
      binding.appSlug,
    ],
    { purpose: "Release tag publisher installation verification" },
  );
  return { action: "verify", readiness: JSON.parse(readiness) };
}

export function rotateReleaseTagPublisher({
  privateKeyFile,
  dependencies: overrides,
}) {
  const dependencies = dependenciesWith(overrides);
  return withAdmittedPrivateKey(privateKeyFile, (admission) => {
    dependencies.authorizeRecovery({
      action: "release-tag-publisher.rotate-staged-key",
      privateKeySha256: admission.digest,
    });
    requireBoundNativePair(dependencies);
    admission.assertUnchanged();
    invokeProvisioner(dependencies, "rotate", {
      descriptor: admission.descriptor,
      expectedSha256: admission.digest,
    });
    admission.assertUnchanged();
    return { action: "rotate" };
  });
}

export function inspectReleaseTagPublisherCredential({
  dependencies: overrides,
} = {}) {
  const dependencies = dependenciesWith(overrides);
  requireBoundNativePair(dependencies);
  const result = invokeProvisioner(dependencies, "inspect");
  return { action: "inspect", state: result.state };
}

export function discardReleaseTagPublisherRecovery({
  expectedSha256,
  dependencies: overrides,
}) {
  const dependencies = dependenciesWith(overrides);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    fail("The expected release App key digest is invalid.");
  }
  dependencies.authorizeRecovery({
    action: "release-tag-publisher.discard-staged-key",
    privateKeySha256: expectedSha256,
  });
  requireBoundNativePair(dependencies);
  const result = invokeProvisioner(dependencies, "discard-recovery", {
    expectedSha256,
  });
  return { action: "discard-recovery", changed: result.changed };
}

export function revokeReleaseTagPublisher({ dependencies: overrides } = {}) {
  const dependencies = dependenciesWith(overrides);
  dependencies.authorizeRecovery({
    action: "release-tag-publisher.revoke-active-credential",
    appId: RELEASE_GITHUB_APP_ID,
    appSlug: RELEASE_GITHUB_APP_SLUG,
    repo: "freed-project/freed",
  });
  requireBoundNativePair(dependencies);
  invokeProvisioner(dependencies, "revoke");
  runChecked(
    dependencies,
    "/usr/bin/sudo",
    ["/bin/rm", "-f", dependencies.configPath],
    { purpose: "Release tag publisher binding revocation" },
  );
  return { action: "revoke" };
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (
      ![
        "--app-id",
        "--app-slug",
        "--private-key-file",
        "--expected-sha256",
      ].includes(flag)
    ) {
      fail(`Unknown installer option: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || options[flag] !== undefined) {
      fail(`Installer option ${flag} requires one value and may appear once.`);
    }
    options[flag] = value;
    index += 1;
  }
  return options;
}

function requireOptionSet(options, required) {
  const actual = Object.keys(options).sort();
  const expected = [...required].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`This installer action requires exactly: ${expected.join(", ")}.`);
  }
}

function main(argv) {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  let result;
  switch (command) {
    case "prepare":
      if (rest.length !== 0) fail("prepare accepts no options.");
      result = prepareReleaseTagPublisher();
      break;
    case "activate":
      requireOptionSet(options, ["--app-id", "--app-slug"]);
      result = activateReleaseTagPublisher({
        appId: options["--app-id"],
        appSlug: options["--app-slug"],
      });
      break;
    case "provision":
    case "recover":
      requireOptionSet(options, [
        "--app-id",
        "--app-slug",
        "--private-key-file",
      ]);
      result = provisionReleaseTagPublisher({
        appId: options["--app-id"],
        appSlug: options["--app-slug"],
        privateKeyFile: options["--private-key-file"],
      });
      break;
    case "verify":
      if (rest.length !== 0) fail("verify accepts no options.");
      result = verifyReleaseTagPublisher();
      break;
    case "rotate":
      requireOptionSet(options, ["--private-key-file"]);
      result = rotateReleaseTagPublisher({
        privateKeyFile: options["--private-key-file"],
      });
      break;
    case "inspect":
      if (rest.length !== 0) fail("inspect accepts no options.");
      result = inspectReleaseTagPublisherCredential();
      break;
    case "discard-recovery":
      requireOptionSet(options, ["--expected-sha256"]);
      result = discardReleaseTagPublisherRecovery({
        expectedSha256: options["--expected-sha256"],
      });
      break;
    case "revoke":
      if (rest.length !== 0) fail("revoke accepts no options.");
      result = revokeReleaseTagPublisher();
      break;
    default:
      fail(
        "Usage: node scripts/release-tag-publisher-install.mjs <prepare|activate|provision|recover|inspect|verify|rotate|discard-recovery|revoke> [options]",
      );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] === __filename) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
