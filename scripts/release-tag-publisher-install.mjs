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
const RELEASE_TAG_PUBLISHER_KEYCHAIN_SERVICE =
  "freed-release-tag-publisher";
const RELEASE_TAG_PUBLISHER_KEYCHAIN_ACCOUNT = "github-app-private-key";
const MAXIMUM_PRIVATE_KEY_BYTES = 32 * 1_024;
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
    authorizeRecovery() {
      fail(
        "Release Publisher recovery is unavailable until exact current-task owner confirmation is integrated from the outcome-ledger repair.",
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
      "Release tag publisher provisioner installation",
    );
    return {
      action: "prepare",
      hostPath: dependencies.hostPath,
      provisionerPath: dependencies.provisionerPath,
      publisherSha256: sha256File(dependencies.hostPath),
    };
  });
}

function validateAppIdentity(appId, appSlug) {
  const numericId = Number(appId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    fail("The release GitHub App ID must be a positive integer.");
  }
  if (
    typeof appSlug !== "string" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(appSlug)
  ) {
    fail("The release GitHub App slug is invalid.");
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
  requireInstalledExecutable(dependencies, dependencies.hostPath);
  requireInstalledExecutable(dependencies, dependencies.provisionerPath);
  const publisherSha256 = sha256File(dependencies.hostPath);
  const binding = {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-binding",
    status: "active",
    repo: "freed-project/freed",
    appId: identity.appId,
    appSlug: identity.appSlug,
    publisherPath: dependencies.hostPath,
    publisherSha256,
  };
  withPrivateDirectory(dependencies, (directory) => {
    const source = path.join(directory, "release-tag-publisher.json");
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
      "Release tag publisher binding installation",
    );
  });
  const attestation = runChecked(
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
  );
  return { action: "activate", binding, attestation: JSON.parse(attestation) };
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
  const output = runChecked(
    dependencies,
    dependencies.provisionerPath,
    args,
    {
      purpose: `Release tag publisher key ${action}`,
      stdio: [descriptor ?? "ignore", "pipe", "pipe"],
    },
  );
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
      requireInstalledExecutable(dependencies, dependencies.hostPath);
      requireInstalledExecutable(dependencies, dependencies.provisionerPath);
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
  const binding = JSON.parse(readFileSync(dependencies.configPath, "utf8"));
  requireInstalledExecutable(dependencies, dependencies.hostPath);
  requireInstalledExecutable(dependencies, dependencies.provisionerPath);
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
    requireInstalledExecutable(dependencies, dependencies.hostPath);
    requireInstalledExecutable(dependencies, dependencies.provisionerPath);
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
  requireInstalledExecutable(dependencies, dependencies.hostPath);
  requireInstalledExecutable(dependencies, dependencies.provisionerPath);
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
  requireInstalledExecutable(dependencies, dependencies.hostPath);
  requireInstalledExecutable(dependencies, dependencies.provisionerPath);
  const result = invokeProvisioner(dependencies, "discard-recovery", {
    expectedSha256,
  });
  return { action: "discard-recovery", changed: result.changed };
}

export function revokeReleaseTagPublisher({ dependencies: overrides } = {}) {
  const dependencies = dependenciesWith(overrides);
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
