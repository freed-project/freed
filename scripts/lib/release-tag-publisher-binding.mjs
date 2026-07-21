import { createHash } from "node:crypto";
import path from "node:path";

export const RELEASE_TAG_PUBLISHER_BINDING_SCHEMA_VERSION = 3;
export const RELEASE_TAG_PUBLISHER_BINDING_PURPOSE =
  "freed-release-tag-publisher-binding";
export const RELEASE_TAG_PUBLISHER_REPO = "freed-project/freed";
export const RELEASE_TAG_PUBLISHER_APP_ID = 4_296_969;
export const RELEASE_TAG_PUBLISHER_APP_SLUG = "freed-release-publisher";

export const RELEASE_TAG_PUBLISHER_BINDING_KEYS = Object.freeze([
  "appId",
  "appSlug",
  "nativePairSha256",
  "provisionerCdHash",
  "provisionerPath",
  "provisionerSha256",
  "publisherCdHash",
  "publisherPath",
  "publisherSha256",
  "purpose",
  "repo",
  "schemaVersion",
  "status",
]);

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function validAbsolutePath(value) {
  return (
    typeof value === "string" &&
    path.isAbsolute(value) &&
    !value.includes("\n") &&
    !value.includes("\r")
  );
}

function validSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validCdHash(value) {
  return typeof value === "string" && /^[0-9a-f]{40,64}$/.test(value);
}

export function releaseTagPublisherNativePairSha256({
  publisherPath,
  publisherSha256,
  publisherCdHash,
  provisionerPath,
  provisionerSha256,
  provisionerCdHash,
}) {
  if (
    !validAbsolutePath(publisherPath) ||
    !validSha256(publisherSha256) ||
    !validCdHash(publisherCdHash) ||
    !validAbsolutePath(provisionerPath) ||
    !validSha256(provisionerSha256) ||
    !validCdHash(provisionerCdHash)
  ) {
    throw new Error("Release tag publisher native pair identity is invalid.");
  }
  const payload = [
    "freed-release-tag-publisher-native-pair-v2",
    publisherPath,
    publisherSha256,
    publisherCdHash,
    provisionerPath,
    provisionerSha256,
    provisionerCdHash,
    "",
  ].join("\n");
  return createHash("sha256").update(payload).digest("hex");
}

export function verifyReleaseTagPublisherBindingShape(
  binding,
  { statuses = ["active"] } = {},
) {
  if (
    !hasExactKeys(binding, RELEASE_TAG_PUBLISHER_BINDING_KEYS) ||
    binding.schemaVersion !== RELEASE_TAG_PUBLISHER_BINDING_SCHEMA_VERSION ||
    binding.purpose !== RELEASE_TAG_PUBLISHER_BINDING_PURPOSE ||
    !statuses.includes(binding.status) ||
    binding.repo !== RELEASE_TAG_PUBLISHER_REPO ||
    binding.appId !== RELEASE_TAG_PUBLISHER_APP_ID ||
    binding.appSlug !== RELEASE_TAG_PUBLISHER_APP_SLUG ||
    !validAbsolutePath(binding.publisherPath) ||
    !validSha256(binding.publisherSha256) ||
    !validCdHash(binding.publisherCdHash) ||
    !validAbsolutePath(binding.provisionerPath) ||
    !validSha256(binding.provisionerSha256) ||
    !validCdHash(binding.provisionerCdHash) ||
    !validSha256(binding.nativePairSha256)
  ) {
    throw new Error("Release tag publisher binding is missing or malformed.");
  }
  const expectedPair = releaseTagPublisherNativePairSha256(binding);
  if (binding.nativePairSha256 !== expectedPair) {
    throw new Error("Release tag publisher native pair digest is invalid.");
  }
  return binding;
}
