#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
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
  loadAndVerifyReleaseTagPublisher,
  verifyReleaseTagPublisherInstallation,
  verifyReleaseTagPublisherReadiness,
} from "./lib/release-tag-publisher.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

export const RELEASE_TAG_PUBLISHER_DIRECTORY =
  "/Library/Application Support/Freed";
export const RELEASE_TAG_PUBLISHER_HOST = path.join(
  RELEASE_TAG_PUBLISHER_DIRECTORY,
  "release-tag-publisher",
);
export const RELEASE_TAG_PUBLISHER_CONFIG = path.join(
  RELEASE_TAG_PUBLISHER_DIRECTORY,
  "release-tag-publisher.json",
);
const LEGACY_RELEASE_TAG_PUBLISHER_PROVISIONER = path.join(
  RELEASE_TAG_PUBLISHER_DIRECTORY,
  "release-tag-publisher-provision",
);

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
    legacyProvisionerPath: LEGACY_RELEASE_TAG_PUBLISHER_PROVISIONER,
    configPath: RELEASE_TAG_PUBLISHER_CONFIG,
    privateKeyPath: path.join(
      os.userInfo().homedir,
      ".freed",
      "credentials",
      "github-apps",
      "freed-release-publisher.private-key.pem",
    ),
    loadBinding: loadAndVerifyReleaseTagPublisher,
    verifyInstallation: verifyReleaseTagPublisherInstallation,
    verifyAttestation: verifyReleaseTagPublisherReadiness,
    run: spawnSync,
  };
}

function dependenciesWith(overrides = {}) {
  return { ...defaultDependencies(), ...overrides };
}

function runChecked(dependencies, executable, args, options = {}) {
  const result = dependencies.run(executable, args, {
    cwd: options.cwd ?? dependencies.repoRoot,
    encoding: options.encoding ?? "utf8",
    maxBuffer: options.maxBuffer,
    stdio: options.stdio,
    timeout: options.timeout,
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
    runChecked(
      dependencies,
      "/bin/bash",
      [
        dependencies.buildScript,
        "--host-output",
        hostOutput,
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
    runChecked(
      dependencies,
      "/usr/bin/sudo",
      ["/bin/rm", "-f", dependencies.legacyProvisionerPath],
      { purpose: "Legacy release tag publisher provisioner removal" },
    );
    return {
      action: "prepare",
      hostPath: dependencies.hostPath,
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

function installBinding(dependencies, binding) {
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
      `Release tag publisher ${binding.status} binding installation`,
    );
  });
}

export function activateReleaseTagPublisher({
  appId,
  appSlug,
  dependencies: overrides,
}) {
  const dependencies = dependenciesWith(overrides);
  const identity = validateAppIdentity(appId, appSlug);
  inspectInstalledHost(dependencies.hostPath);
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
  installBinding(dependencies, { ...binding, status: "pending" });
  const rawAttestation = runChecked(
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
    { purpose: "Release tag publisher local attestation", timeout: 30_000 },
  );
  let attestation;
  try {
    attestation = JSON.parse(rawAttestation);
  } catch {
    fail("Release tag publisher activation returned invalid attestation JSON.");
  }
  dependencies.verifyAttestation(attestation, {
    repo: binding.repo,
    releaseAppId: binding.appId,
    releaseAppSlug: binding.appSlug,
    publisherDigest: binding.publisherSha256,
  });
  return {
    action: "activate",
    binding: { ...binding, status: "pending" },
    attestation,
  };
}

function inspectPrivateKeyFile(filePath) {
  if (!path.isAbsolute(filePath) || realpathSync(filePath) !== filePath) {
    fail("The private key file must use a canonical absolute path.");
  }
  const link = lstatSync(filePath);
  const metadata = statSync(filePath);
  if (
    link.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.uid !== process.getuid() ||
    metadata.nlink !== 1 ||
    (metadata.mode & 0o7777) !== 0o600
  ) {
    fail(
      "The private key file must be a mode 0600 current-user file with one link.",
    );
  }
  return filePath;
}

export function provisionReleaseTagPublisher({
  appId,
  appSlug,
  privateKeyFile,
  dependencies: overrides,
}) {
  const dependencies = dependenciesWith(overrides);
  const keyFile = inspectPrivateKeyFile(privateKeyFile);
  if (keyFile !== dependencies.privateKeyPath) {
    fail(
      `The private key must already be stored at ${dependencies.privateKeyPath}.`,
    );
  }
  const prepared = prepareReleaseTagPublisher({ dependencies });
  const activated = activateReleaseTagPublisher({
    appId,
    appSlug,
    dependencies,
  });
  const finalized = finalizeReleaseTagPublisher({ dependencies });
  return {
    action: "provision",
    prepared,
    activated,
    finalized,
    privateKeyPath: keyFile,
  };
}

function verifyBindingInstallation(dependencies, binding) {
  return dependencies.verifyInstallation(binding, {
    exec(file, args, options) {
      return runChecked(dependencies, file, args, {
        ...options,
        purpose: "Release tag publisher installation verification",
      });
    },
  });
}

export function finalizeReleaseTagPublisher({ dependencies: overrides } = {}) {
  const dependencies = dependenciesWith(overrides);
  const pending = dependencies.loadBinding({
    configPath: dependencies.configPath,
    requiredStatus: "pending",
  });
  const readiness = verifyBindingInstallation(dependencies, pending);
  const { configPath: _configPath, ...binding } = pending;
  const active = { ...binding, status: "active" };
  installBinding(dependencies, active);
  return { action: "finalize", binding: active, readiness };
}

export function verifyReleaseTagPublisher({ dependencies: overrides } = {}) {
  const dependencies = dependenciesWith(overrides);
  const binding = dependencies.loadBinding({
    configPath: dependencies.configPath,
    requiredStatus: "active",
  });
  const readiness = verifyBindingInstallation(dependencies, binding);
  return { action: "verify", binding, readiness };
}

export function rotateReleaseTagPublisher() {
  fail(
    "Release App key rotation is disabled until an atomic verified rollback flow is available.",
  );
}

export function revokeReleaseTagPublisher() {
  fail(
    "Release App credential revocation is disabled until a reviewed credential archival flow is available.",
  );
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--app-id", "--app-slug", "--private-key-file"].includes(flag)) {
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
      result = activateReleaseTagPublisher({
        appId: options["--app-id"],
        appSlug: options["--app-slug"],
      });
      break;
    case "provision":
      result = provisionReleaseTagPublisher({
        appId: options["--app-id"],
        appSlug: options["--app-slug"],
        privateKeyFile: options["--private-key-file"],
      });
      break;
    case "finalize":
      if (rest.length !== 0) fail("finalize accepts no options.");
      result = finalizeReleaseTagPublisher();
      break;
    case "verify":
      if (rest.length !== 0) fail("verify accepts no options.");
      result = verifyReleaseTagPublisher();
      break;
    case "rotate":
      result = rotateReleaseTagPublisher({
        privateKeyFile: options["--private-key-file"],
      });
      break;
    case "revoke":
      if (rest.length !== 0) fail("revoke accepts no options.");
      result = revokeReleaseTagPublisher();
      break;
    default:
      fail(
        "Usage: node scripts/release-tag-publisher-install.mjs <prepare|activate|finalize|provision|verify|rotate|revoke> [options]",
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
