import assert from "node:assert/strict";
import test from "node:test";

import {
  verifyReleaseTagPublisherBinding,
  verifyReleaseTagPublisherInstallation,
  verifyReleaseTagPublisherInstallationReadiness,
} from "./release-tag-publisher.mjs";

function fixture() {
  const digest = "a".repeat(64);
  const config = {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-binding",
    status: "active",
    repo: "freed-project/freed",
    appId: 123456,
    appSlug: "freed-release-publisher",
    publisherPath: "/Library/Application Support/Freed/release-tag-publisher",
    publisherSha256: digest,
  };
  const attestation = {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-readiness",
    repo: config.repo,
    appId: config.appId,
    appSlug: config.appSlug,
    credentialMode: "short-lived-installation-token",
    operations: ["create-annotated-tag"],
    allowsArbitraryRefs: false,
    allowsUpdates: false,
    allowsDeletions: false,
    digest,
  };
  return { config, attestation, digest };
}

function installationAttestation() {
  return {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-installation-readiness",
    repo: "freed-project/freed",
    appId: 123456,
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

test("publisher binding pins the exact App, operation, and executable digest", () => {
  const { config, attestation, digest } = fixture();
  assert.deepEqual(
    verifyReleaseTagPublisherBinding(config, digest, attestation),
    { ready: true, publisherDigest: digest },
  );
  assert.throws(
    () => verifyReleaseTagPublisherBinding(config, "b".repeat(64), attestation),
    /digest does not match/,
  );
  assert.throws(
    () =>
      verifyReleaseTagPublisherBinding(config, digest, {
        ...attestation,
        operations: ["create-annotated-tag", "delete-tag"],
      }),
    /does not match the pinned short-lived annotated-tag publisher/,
  );
});

test("installation readiness accepts only the exact dedicated App scope", () => {
  const attestation = installationAttestation();
  const expected = {
    repo: "freed-project/freed",
    releaseAppId: 123456,
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
  const binding = {
    repo: "freed-project/freed",
    appId: 123456,
    appSlug: "freed-release-publisher",
    publisherPath: "/trusted/release-tag-publisher",
  };
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
    "123456",
    "--app-slug",
    "freed-release-publisher",
  ]);
  assert.equal(calls[0].options.encoding, "utf8");
});
