import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { verifyReleaseTagPublisherBindingShape } from "./release-tag-publisher-binding.mjs";

export const RELEASE_TAG_PUBLISHER_CONFIG =
  "/Library/Application Support/Freed/release-tag-publisher.json";

export const RELEASE_TAG_INSTALLATION_READINESS_PURPOSE =
  "freed-release-tag-publisher-installation-readiness";

const RELEASE_ACCOUNT = "freed-project";

function hasExactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort())
  );
}

function verifyRootOwnedParents(filePath) {
  let current = path.dirname(filePath);
  while (true) {
    const metadata = statSync(current);
    if (
      !metadata.isDirectory() ||
      metadata.uid !== 0 ||
      (metadata.mode & 0o022) !== 0
    ) {
      throw new Error(
        `Release tag publisher parent ${current} must be a root-owned directory that is not group or world writable.`,
      );
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function verifyPinnedFile(filePath, { executable = false } = {}) {
  if (!path.isAbsolute(filePath) || realpathSync(filePath) !== filePath) {
    throw new Error(
      `Release tag publisher path ${filePath} must be an absolute non-symlink path.`,
    );
  }
  const linkMetadata = lstatSync(filePath);
  const metadata = statSync(filePath);
  if (
    linkMetadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.uid !== 0 ||
    (metadata.mode & 0o022) !== 0 ||
    (executable && (metadata.mode & 0o111) === 0)
  ) {
    throw new Error(
      `Release tag publisher path ${filePath} must be a root-owned ${executable ? "executable" : "file"} that is not group or world writable.`,
    );
  }
  verifyRootOwnedParents(filePath);
  return metadata;
}

export function verifyReleaseTagPublisherReadiness(
  attestation,
  {
    repo,
    releaseAppId,
    releaseAppSlug,
    publisherDigest,
    provisionerDigest,
    nativePairDigest,
  },
) {
  const expectedOperations = ["create-annotated-tag"];
  if (
    !hasExactKeys(attestation, [
      "allowsArbitraryRefs",
      "allowsDeletions",
      "allowsUpdates",
      "appId",
      "appSlug",
      "credentialMode",
      "nativePairSha256",
      "operations",
      "provisionerSha256",
      "publisherSha256",
      "purpose",
      "repo",
      "schemaVersion",
    ]) ||
    attestation.schemaVersion !== 2 ||
    attestation?.purpose !== "freed-release-tag-publisher-readiness" ||
    attestation?.repo !== repo ||
    Number(attestation?.appId) !== Number(releaseAppId) ||
    String(attestation?.appSlug ?? "").toLowerCase() !==
      String(releaseAppSlug ?? "").toLowerCase() ||
    attestation?.credentialMode !== "short-lived-installation-token" ||
    JSON.stringify(attestation?.operations) !==
      JSON.stringify(expectedOperations) ||
    attestation?.allowsArbitraryRefs !== false ||
    attestation?.allowsUpdates !== false ||
    attestation?.allowsDeletions !== false ||
    attestation?.publisherSha256 !== publisherDigest ||
    attestation?.provisionerSha256 !== provisionerDigest ||
    attestation?.nativePairSha256 !== nativePairDigest
  ) {
    throw new Error(
      "Release tag publisher attestation does not match the pinned short-lived annotated-tag publisher.",
    );
  }
  return {
    ready: true,
    publisherDigest,
    provisionerDigest,
    nativePairDigest,
  };
}

export function verifyReleaseTagPublisherInstallationReadiness(
  attestation,
  { repo, releaseAppId, releaseAppSlug },
) {
  const expectedAppId = Number(releaseAppId);
  const expectedKeys = [
    "accountLogin",
    "accountType",
    "appEvents",
    "appExternalUrl",
    "appId",
    "appName",
    "appOwnerLogin",
    "appOwnerType",
    "appPermissions",
    "appSlug",
    "installationId",
    "permissions",
    "purpose",
    "repo",
    "repositories",
    "repositorySelection",
    "schemaVersion",
  ];
  if (
    !hasExactKeys(attestation, expectedKeys) ||
    attestation.schemaVersion !== 1 ||
    attestation.purpose !== RELEASE_TAG_INSTALLATION_READINESS_PURPOSE ||
    attestation.repo !== repo ||
    !Number.isSafeInteger(expectedAppId) ||
    expectedAppId <= 0 ||
    !Number.isSafeInteger(attestation.appId) ||
    attestation.appId !== expectedAppId ||
    attestation.appSlug !== releaseAppSlug ||
    attestation.appName !== "Freed Release Publisher" ||
    attestation.appExternalUrl !== "https://freed.wtf" ||
    attestation.appOwnerLogin !== RELEASE_ACCOUNT ||
    attestation.appOwnerType !== "Organization" ||
    !hasExactKeys(attestation.appPermissions, ["contents", "metadata"]) ||
    attestation.appPermissions.contents !== "write" ||
    attestation.appPermissions.metadata !== "read" ||
    JSON.stringify(attestation.appEvents) !== JSON.stringify([]) ||
    !Number.isSafeInteger(attestation.installationId) ||
    attestation.installationId <= 0 ||
    attestation.accountLogin !== RELEASE_ACCOUNT ||
    attestation.accountType !== "Organization" ||
    attestation.repositorySelection !== "selected" ||
    !hasExactKeys(attestation.permissions, ["contents", "metadata"]) ||
    attestation.permissions.contents !== "write" ||
    attestation.permissions.metadata !== "read" ||
    JSON.stringify(attestation.repositories) !== JSON.stringify([repo])
  ) {
    throw new Error(
      "Release tag publisher installation attestation does not match the dedicated selected-repository App contract.",
    );
  }
  return {
    ready: true,
    installationId: attestation.installationId,
    attestation,
  };
}

export function verifyReleaseTagPublisherConfig(config) {
  return verifyReleaseTagPublisherBindingShape(config, {
    statuses: ["active"],
  });
}

export function verifyReleaseTagPublisherInstallation(
  binding,
  { exec = execFileSync } = {},
) {
  verifyReleaseTagPublisherConfig(binding);
  const raw = exec(
    binding.publisherPath,
    [
      "verify-installation",
      "--repo",
      binding.repo,
      "--app-id",
      String(binding.appId),
      "--app-slug",
      binding.appSlug,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  let attestation;
  try {
    attestation = JSON.parse(raw);
  } catch {
    throw new Error(
      "Release tag publisher installation check did not return one JSON attestation.",
    );
  }
  return verifyReleaseTagPublisherInstallationReadiness(attestation, {
    repo: binding.repo,
    releaseAppId: binding.appId,
    releaseAppSlug: binding.appSlug,
  });
}

export function verifyReleaseTagPublisherBinding(
  config,
  actualPublisherDigest,
  actualProvisionerDigest,
  attestation,
) {
  verifyReleaseTagPublisherConfig(config);
  if (actualPublisherDigest !== config.publisherSha256) {
    throw new Error(
      "Release tag publisher executable digest does not match its binding.",
    );
  }
  if (actualProvisionerDigest !== config.provisionerSha256) {
    throw new Error(
      "Release tag publisher provisioner digest does not match its binding.",
    );
  }
  verifyReleaseTagPublisherReadiness(attestation, {
    repo: config.repo,
    releaseAppId: config.appId,
    releaseAppSlug: config.appSlug,
    publisherDigest: config.publisherSha256,
    provisionerDigest: config.provisionerSha256,
    nativePairDigest: config.nativePairSha256,
  });
  return {
    ready: true,
    publisherDigest: actualPublisherDigest,
    provisionerDigest: actualProvisionerDigest,
    nativePairDigest: config.nativePairSha256,
  };
}

export function loadAndVerifyReleaseTagPublisher({
  configPath = RELEASE_TAG_PUBLISHER_CONFIG,
  exec = execFileSync,
} = {}) {
  verifyPinnedFile(configPath);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  verifyReleaseTagPublisherConfig(config);
  verifyPinnedFile(config.publisherPath, { executable: true });
  verifyPinnedFile(config.provisionerPath, { executable: true });
  const publisherDigest = createHash("sha256")
    .update(readFileSync(config.publisherPath))
    .digest("hex");
  const provisionerDigest = createHash("sha256")
    .update(readFileSync(config.provisionerPath))
    .digest("hex");
  const attestation = JSON.parse(
    exec(
      config.publisherPath,
      [
        "attest",
        "--repo",
        config.repo,
        "--app-id",
        String(config.appId),
        "--app-slug",
        config.appSlug,
      ],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    ),
  );
  verifyReleaseTagPublisherBinding(
    config,
    publisherDigest,
    provisionerDigest,
    attestation,
  );
  return { ...config, configPath };
}
