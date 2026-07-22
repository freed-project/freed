import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { verifyReleaseTagPublisherBindingShape } from "./release-tag-publisher-binding.mjs";

export const RELEASE_TAG_PUBLISHER_CONFIG =
  "/Library/Application Support/Freed/release-tag-publisher.json";
const RELEASE_TAG_PUBLISHER_HOST =
  "/Library/Application Support/Freed/release-tag-publisher";
const RELEASE_TAG_PUBLISHER_PROVISIONER =
  "/Library/Application Support/Freed/release-tag-publisher-provision";

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
    metadata.nlink !== 1 ||
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
    publisherCdHash,
    provisionerDigest,
    provisionerCdHash,
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
      "provisionerCdHash",
      "provisionerSha256",
      "publisherCdHash",
      "publisherSha256",
      "purpose",
      "repo",
      "schemaVersion",
    ]) ||
    attestation.schemaVersion !== 3 ||
    attestation?.purpose !== "freed-release-tag-publisher-readiness" ||
    attestation?.repo !== repo ||
    !Number.isSafeInteger(releaseAppId) ||
    attestation?.appId !== releaseAppId ||
    typeof releaseAppSlug !== "string" ||
    attestation?.appSlug !== releaseAppSlug ||
    attestation?.credentialMode !== "short-lived-installation-token" ||
    JSON.stringify(attestation?.operations) !==
      JSON.stringify(expectedOperations) ||
    attestation?.allowsArbitraryRefs !== false ||
    attestation?.allowsUpdates !== false ||
    attestation?.allowsDeletions !== false ||
    attestation?.publisherSha256 !== publisherDigest ||
    attestation?.publisherCdHash !== publisherCdHash ||
    attestation?.provisionerSha256 !== provisionerDigest ||
    attestation?.provisionerCdHash !== provisionerCdHash ||
    attestation?.nativePairSha256 !== nativePairDigest
  ) {
    throw new Error(
      "Release tag publisher attestation does not match the pinned short-lived annotated-tag publisher.",
    );
  }
  return {
    ready: true,
    publisherDigest,
    publisherCdHash,
    provisionerDigest,
    provisionerCdHash,
    nativePairDigest,
  };
}

export function verifyReleaseTagPublisherInstallationReadiness(
  attestation,
  { repo, releaseAppId, releaseAppSlug },
) {
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
    !Number.isSafeInteger(releaseAppId) ||
    releaseAppId <= 0 ||
    typeof releaseAppSlug !== "string" ||
    !Number.isSafeInteger(attestation.appId) ||
    attestation.appId !== releaseAppId ||
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
    publisherCdHash: config.publisherCdHash,
    provisionerDigest: config.provisionerSha256,
    provisionerCdHash: config.provisionerCdHash,
    nativePairDigest: config.nativePairSha256,
  });
  return {
    ready: true,
    publisherDigest: actualPublisherDigest,
    publisherCdHash: config.publisherCdHash,
    provisionerDigest: actualProvisionerDigest,
    provisionerCdHash: config.provisionerCdHash,
    nativePairDigest: config.nativePairSha256,
  };
}

function parseExactHostJSON(raw, label) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      `Release tag publisher ${label} did not return one JSON object.`,
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Release tag publisher ${label} did not return one JSON object.`,
    );
  }
  return value;
}

function verifyReleaseTagPublishResult(result, binding, argumentsList) {
  const option = (name) => {
    const index = argumentsList.indexOf(name);
    return index >= 0 ? argumentsList[index + 1] : undefined;
  };
  if (
    !hasExactKeys(result, [
      "commit",
      "purpose",
      "recovered",
      "repo",
      "schemaVersion",
      "tag",
      "tagObjectSha",
    ]) ||
    result.schemaVersion !== 1 ||
    result.purpose !== "freed-release-tag-publish-result" ||
    result.repo !== binding.repo ||
    result.tag !== option("--tag") ||
    result.commit !== option("--commit") ||
    typeof result.recovered !== "boolean" ||
    typeof result.tagObjectSha !== "string" ||
    !/^[0-9a-f]{40}$/.test(result.tagObjectSha)
  ) {
    throw new Error(
      "Release tag publisher returned an inexact publish result.",
    );
  }
  return result;
}

export function invokeReleaseTagPublisherAction(
  binding,
  argumentsList,
  { exec = execFileSync } = {},
) {
  verifyReleaseTagPublisherConfig(binding);
  const action = argumentsList[0];
  if (!["attest", "verify-installation", "publish"].includes(action)) {
    throw new Error("Release tag publisher received an unsupported action.");
  }
  const raw = exec(RELEASE_TAG_PUBLISHER_HOST, argumentsList, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: action === "publish" ? 120_000 : 30_000,
    env: {
      HOME: process.env.HOME ?? "",
      PATH: "/usr/bin:/bin",
    },
  });
  const result = parseExactHostJSON(raw, action);
  if (action === "attest") {
    verifyReleaseTagPublisherReadiness(result, {
      repo: binding.repo,
      releaseAppId: binding.appId,
      releaseAppSlug: binding.appSlug,
      publisherDigest: binding.publisherSha256,
      publisherCdHash: binding.publisherCdHash,
      provisionerDigest: binding.provisionerSha256,
      provisionerCdHash: binding.provisionerCdHash,
      nativePairDigest: binding.nativePairSha256,
    });
    return result;
  }
  if (action === "verify-installation") {
    verifyReleaseTagPublisherInstallationReadiness(result, {
      repo: binding.repo,
      releaseAppId: binding.appId,
      releaseAppSlug: binding.appSlug,
    });
    return result;
  }
  return verifyReleaseTagPublishResult(result, binding, argumentsList);
}

export function verifyReleaseTagPublisherInstallation(
  binding,
  { exec = execFileSync } = {},
) {
  const attestation = invokeReleaseTagPublisherAction(
    binding,
    [
      "verify-installation",
      "--repo",
      binding.repo,
      "--app-id",
      String(binding.appId),
      "--app-slug",
      binding.appSlug,
    ],
    { exec },
  );
  return {
    ready: true,
    installationId: attestation.installationId,
    attestation,
  };
}

export function loadAndVerifyReleaseTagPublisher({
  configPath = RELEASE_TAG_PUBLISHER_CONFIG,
} = {}) {
  verifyPinnedFile(configPath);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  verifyReleaseTagPublisherConfig(config);
  if (
    config.publisherPath !== RELEASE_TAG_PUBLISHER_HOST ||
    config.provisionerPath !== RELEASE_TAG_PUBLISHER_PROVISIONER
  ) {
    throw new Error(
      "Release tag publisher binding does not use the fixed native paths.",
    );
  }
  verifyPinnedFile(config.publisherPath, { executable: true });
  verifyPinnedFile(config.provisionerPath, { executable: true });
  const publisherDigest = createHash("sha256")
    .update(readFileSync(config.publisherPath))
    .digest("hex");
  const provisionerDigest = createHash("sha256")
    .update(readFileSync(config.provisionerPath))
    .digest("hex");
  if (
    publisherDigest !== config.publisherSha256 ||
    provisionerDigest !== config.provisionerSha256
  ) {
    throw new Error(
      "Release tag publisher native file digest does not match its binding.",
    );
  }
  return { ...config, configPath };
}
