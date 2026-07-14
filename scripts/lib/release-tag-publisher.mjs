import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export const RELEASE_TAG_PUBLISHER_CONFIG =
  "/Library/Application Support/Freed/release-tag-publisher.json";

export const RELEASE_TAG_INSTALLATION_READINESS_PURPOSE =
  "freed-release-tag-publisher-installation-readiness";

const RELEASE_REPO = "freed-project/freed";
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
  { repo, releaseAppId, releaseAppSlug, publisherDigest },
) {
  const expectedOperations = ["create-annotated-tag"];
  if (
    attestation?.schemaVersion !== 1 ||
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
    attestation?.digest !== publisherDigest
  ) {
    throw new Error(
      "Release tag publisher attestation does not match the pinned short-lived annotated-tag publisher.",
    );
  }
  return { ready: true, publisherDigest };
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
  if (
    config?.schemaVersion !== 1 ||
    config?.purpose !== "freed-release-tag-publisher-binding" ||
    config?.status !== "active" ||
    config?.repo !== RELEASE_REPO ||
    !Number.isSafeInteger(config?.appId) ||
    config.appId <= 0 ||
    typeof config?.appSlug !== "string" ||
    config.appSlug.length === 0 ||
    typeof config?.publisherPath !== "string" ||
    !/^[0-9a-f]{64}$/.test(config?.publisherSha256 ?? "")
  ) {
    throw new Error("Release tag publisher binding is missing or malformed.");
  }
  return config;
}

export function verifyReleaseTagPublisherInstallation(
  binding,
  { exec = execFileSync } = {},
) {
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
  actualDigest,
  attestation,
) {
  verifyReleaseTagPublisherConfig(config);
  if (actualDigest !== config.publisherSha256) {
    throw new Error(
      "Release tag publisher executable digest does not match its binding.",
    );
  }
  verifyReleaseTagPublisherReadiness(attestation, {
    repo: config.repo,
    releaseAppId: config.appId,
    releaseAppSlug: config.appSlug,
    publisherDigest: config.publisherSha256,
  });
  return { ready: true, publisherDigest: actualDigest };
}

export function loadAndVerifyReleaseTagPublisher({
  configPath = RELEASE_TAG_PUBLISHER_CONFIG,
  exec = execFileSync,
} = {}) {
  verifyPinnedFile(configPath);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  verifyReleaseTagPublisherConfig(config);
  verifyPinnedFile(config.publisherPath, { executable: true });
  const digest = createHash("sha256")
    .update(readFileSync(config.publisherPath))
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
  verifyReleaseTagPublisherBinding(config, digest, attestation);
  return { ...config, configPath };
}
