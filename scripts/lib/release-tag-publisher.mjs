import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";

export const RELEASE_TAG_PUBLISHER_CONFIG =
  "/Library/Application Support/Freed/release-tag-publisher.json";

export const RELEASE_TAG_INSTALLATION_READINESS_PURPOSE =
  "freed-release-tag-publisher-installation-readiness";

const RELEASE_REPO = "freed-project/freed";
const RELEASE_ACCOUNT = "freed-project";
const MAXIMUM_CONFIG_BYTES = 32 * 1_024;
const MAXIMUM_PUBLISHER_BYTES = 64 * 1_024 * 1_024;
const RELEASE_TAG_PUBLISHER_CONFIG_KEYS = [
  "schemaVersion",
  "purpose",
  "status",
  "repo",
  "appId",
  "appSlug",
  "publisherPath",
  "publisherSha256",
];
const RELEASE_TAG_PUBLISHER_READINESS_KEYS = [
  "schemaVersion",
  "purpose",
  "repo",
  "appId",
  "appSlug",
  "credentialMode",
  "operations",
  "allowsArbitraryRefs",
  "allowsUpdates",
  "allowsDeletions",
  "digest",
];

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

function readBoundedFile(filePath, maximumBytes) {
  const descriptor = openSync(
    filePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size > maximumBytes
    ) {
      throw new Error(
        "A release tag publisher file is empty or exceeds its size limit.",
      );
    }
    const data = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < data.length) {
      const read = readSync(
        descriptor,
        data,
        offset,
        data.length - offset,
        null,
      );
      if (read === 0) {
        throw new Error(
          "A release tag publisher file changed while it was being read.",
        );
      }
      offset += read;
    }
    if (readSync(descriptor, Buffer.alloc(1), 0, 1, null) !== 0) {
      throw new Error(
        "A release tag publisher file changed while it was being read.",
      );
    }
    return data;
  } finally {
    closeSync(descriptor);
  }
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

export function verifyReleaseTagPublisherReadiness(
  attestation,
  { repo, releaseAppId, releaseAppSlug, publisherDigest },
) {
  if (
    !hasExactKeys(attestation, RELEASE_TAG_PUBLISHER_READINESS_KEYS) ||
    attestation.schemaVersion !== 1 ||
    attestation.purpose !== "freed-release-tag-publisher-readiness" ||
    attestation.repo !== repo ||
    attestation.appId !== Number(releaseAppId) ||
    attestation.appSlug !== releaseAppSlug ||
    attestation.credentialMode !== "short-lived-installation-token" ||
    JSON.stringify(attestation.operations) !==
      JSON.stringify(["create-annotated-tag"]) ||
    attestation.allowsArbitraryRefs !== false ||
    attestation.allowsUpdates !== false ||
    attestation.allowsDeletions !== false ||
    attestation.digest !== publisherDigest
  ) {
    throw new Error(
      "Release tag publisher attestation does not match the pinned annotated-tag publisher.",
    );
  }
  return { ready: true, publisherDigest, attestation };
}

export function verifyReleaseTagPublisherConfig(
  config,
  { requiredStatus = "active" } = {},
) {
  if (
    !hasExactKeys(config, RELEASE_TAG_PUBLISHER_CONFIG_KEYS) ||
    config?.schemaVersion !== 1 ||
    config?.purpose !== "freed-release-tag-publisher-binding" ||
    config?.status !== requiredStatus ||
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
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
      env: {
        HOME: process.env.HOME ?? "",
        PATH: "/usr/bin:/bin",
      },
    },
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

export function loadAndVerifyReleaseTagPublisher({
  configPath = RELEASE_TAG_PUBLISHER_CONFIG,
  requiredStatus = "active",
  readFile = readBoundedFile,
  verifyFile = verifyPinnedFile,
} = {}) {
  verifyFile(configPath);
  const config = JSON.parse(
    readFile(configPath, MAXIMUM_CONFIG_BYTES).toString("utf8"),
  );
  verifyReleaseTagPublisherConfig(config, { requiredStatus });
  verifyFile(config.publisherPath, { executable: true });
  const digest = createHash("sha256")
    .update(readFile(config.publisherPath, MAXIMUM_PUBLISHER_BYTES))
    .digest("hex");
  if (digest !== config.publisherSha256) {
    throw new Error(
      "Release tag publisher executable digest does not match its binding.",
    );
  }
  return { ...config, configPath };
}

export function publishReleaseTag(
  binding,
  argumentsList,
  { exec = execFileSync } = {},
) {
  return exec(binding.publisherPath, argumentsList, {
    stdio: "inherit",
    timeout: 120_000,
    env: {
      HOME: process.env.HOME ?? "",
      PATH: "/usr/bin:/bin",
    },
  });
}
