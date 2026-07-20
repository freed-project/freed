import assert from "node:assert/strict";
import test from "node:test";

import {
  verifyReleaseTagPublisherBinding,
  verifyReleaseTagPublisherInstallation,
  verifyReleaseTagPublisherInstallationReadiness,
} from "./release-tag-publisher.mjs";
import { releaseTagPublisherNativePairSha256 } from "./release-tag-publisher-binding.mjs";

function fixture() {
  const publisherDigest = "a".repeat(64);
  const provisionerDigest = "b".repeat(64);
  const base = {
    schemaVersion: 2,
    purpose: "freed-release-tag-publisher-binding",
    status: "active",
    repo: "freed-project/freed",
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    publisherPath: "/Library/Application Support/Freed/release-tag-publisher",
    publisherSha256: publisherDigest,
    provisionerPath:
      "/Library/Application Support/Freed/release-tag-publisher-provision",
    provisionerSha256: provisionerDigest,
  };
  const config = {
    ...base,
    nativePairSha256: releaseTagPublisherNativePairSha256(base),
  };
  const attestation = {
    schemaVersion: 2,
    purpose: "freed-release-tag-publisher-readiness",
    repo: config.repo,
    appId: config.appId,
    appSlug: config.appSlug,
    credentialMode: "short-lived-installation-token",
    operations: ["create-annotated-tag"],
    allowsArbitraryRefs: false,
    allowsUpdates: false,
    allowsDeletions: false,
    publisherSha256: publisherDigest,
    provisionerSha256: provisionerDigest,
    nativePairSha256: config.nativePairSha256,
  };
  return { config, attestation, publisherDigest, provisionerDigest };
}

function installationAttestation() {
  return {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-installation-readiness",
    repo: "freed-project/freed",
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    appName: "Freed Release Publisher",
    appExternalUrl: "https://freed.wtf",
    appOwnerLogin: "freed-project",
    appOwnerType: "Organization",
    appPermissions: { contents: "write", metadata: "read" },
    appEvents: [],
    installationId: 42,
    accountLogin: "freed-project",
    accountType: "Organization",
    repositorySelection: "selected",
    permissions: { contents: "write", metadata: "read" },
    repositories: ["freed-project/freed"],
  };
}

test("publisher binding pins the exact App, operation, and native pair", () => {
  const { config, attestation, publisherDigest, provisionerDigest } = fixture();
  assert.deepEqual(
    verifyReleaseTagPublisherBinding(
      config,
      publisherDigest,
      provisionerDigest,
      attestation,
    ),
    {
      ready: true,
      publisherDigest,
      provisionerDigest,
      nativePairDigest: config.nativePairSha256,
    },
  );
  assert.throws(
    () =>
      verifyReleaseTagPublisherBinding(
        config,
        "c".repeat(64),
        provisionerDigest,
        attestation,
      ),
    /digest does not match/,
  );
  assert.throws(
    () =>
      verifyReleaseTagPublisherBinding(
        config,
        publisherDigest,
        "c".repeat(64),
        attestation,
      ),
    /provisioner digest does not match/,
  );
  assert.throws(
    () =>
      verifyReleaseTagPublisherBinding(
        config,
        publisherDigest,
        provisionerDigest,
        {
          ...attestation,
          operations: ["create-annotated-tag", "delete-tag"],
        },
      ),
    /does not match the pinned short-lived annotated-tag publisher/,
  );
  assert.throws(
    () =>
      verifyReleaseTagPublisherBinding(
        { ...config, nativePairSha256: "0".repeat(64) },
        publisherDigest,
        provisionerDigest,
        attestation,
      ),
    /native pair digest is invalid/,
  );
});

test("installation readiness accepts only the exact dedicated App scope", () => {
  const attestation = installationAttestation();
  const expected = {
    repo: "freed-project/freed",
    releaseAppId: 4_296_969,
    releaseAppSlug: "freed-release-publisher",
  };
  assert.deepEqual(
    verifyReleaseTagPublisherInstallationReadiness(attestation, expected),
    { ready: true, installationId: 42, attestation },
  );
  for (const invalid of [
    { ...attestation, repositories: ["freed-project/other"] },
    {
      ...attestation,
      permissions: { contents: "write", metadata: "read", actions: "read" },
    },
    { ...attestation, repositorySelection: "all" },
    { ...attestation, appEvents: ["push"] },
    {
      ...attestation,
      appPermissions: { contents: "write", metadata: "read", actions: "read" },
    },
    { ...attestation, pem: "secret" },
  ]) {
    assert.throws(
      () => verifyReleaseTagPublisherInstallationReadiness(invalid, expected),
      /does not match the dedicated selected-repository App contract/,
    );
  }
});

test("native installation verification uses only the pinned App identity", () => {
  const { config: binding } = fixture();
  const calls = [];
  const result = verifyReleaseTagPublisherInstallation(binding, {
    exec(file, args, options) {
      calls.push({ file, args, options });
      return JSON.stringify(installationAttestation());
    },
  });
  assert.equal(result.installationId, 42);
  assert.deepEqual(calls[0].args, [
    "verify-installation",
    "--repo",
    "freed-project/freed",
    "--app-id",
    "4296969",
    "--app-slug",
    "freed-release-publisher",
  ]);
  assert.equal(calls[0].options.encoding, "utf8");
});
