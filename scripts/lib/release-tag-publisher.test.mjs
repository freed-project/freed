import assert from "node:assert/strict";
import test from "node:test";

import {
  invokeReleaseTagPublisherAction,
  verifyReleaseTagPublisherBinding,
  verifyReleaseTagPublisherInstallation,
  verifyReleaseTagPublisherInstallationReadiness,
} from "./release-tag-publisher.mjs";
import { releaseTagPublisherNativePairSha256 } from "./release-tag-publisher-binding.mjs";

function fixture() {
  const publisherDigest = "a".repeat(64);
  const provisionerDigest = "b".repeat(64);
  const base = {
    schemaVersion: 3,
    purpose: "freed-release-tag-publisher-binding",
    status: "active",
    repo: "freed-project/freed",
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    publisherPath: "/Library/Application Support/Freed/release-tag-publisher",
    publisherSha256: publisherDigest,
    publisherCdHash: "c".repeat(40),
    provisionerPath:
      "/Library/Application Support/Freed/release-tag-publisher-provision",
    provisionerSha256: provisionerDigest,
    provisionerCdHash: "d".repeat(40),
  };
  const config = {
    ...base,
    nativePairSha256: releaseTagPublisherNativePairSha256(base),
  };
  const attestation = {
    schemaVersion: 3,
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
    publisherCdHash: config.publisherCdHash,
    provisionerSha256: provisionerDigest,
    provisionerCdHash: config.provisionerCdHash,
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
      publisherCdHash: config.publisherCdHash,
      provisionerDigest,
      provisionerCdHash: config.provisionerCdHash,
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

test("each wrapper action invokes only the fixed native host", () => {
  const { config, attestation } = fixture();
  const calls = [];
  const args = [
    "attest",
    "--repo",
    config.repo,
    "--app-id",
    String(config.appId),
    "--app-slug",
    config.appSlug,
  ];
  const value = invokeReleaseTagPublisherAction(config, args, {
    exec(file, actualArgs, options) {
      calls.push({ file, args: actualArgs, options });
      return JSON.stringify(attestation);
    },
  });
  assert.deepEqual(value, attestation);
  assert.deepEqual(
    calls.map(({ file, args: actualArgs }) => ({ file, args: actualArgs })),
    [{ file: config.publisherPath, args }],
  );
  assert.equal(calls[0].options.env.PATH, "/usr/bin:/bin");
  assert.equal(calls[0].options.timeout, 30_000);
});

test("credential-bearing wrapper actions have hard deadlines", () => {
  const { config } = fixture();
  const calls = [];
  invokeReleaseTagPublisherAction(
    config,
    [
      "verify-installation",
      "--repo",
      config.repo,
      "--app-id",
      String(config.appId),
      "--app-slug",
      config.appSlug,
    ],
    {
      exec(file, args, options) {
        calls.push({ file, args, options });
        return JSON.stringify(installationAttestation());
      },
    },
  );
  const commit = "a".repeat(40);
  const tag = "v26.7.2200";
  invokeReleaseTagPublisherAction(
    config,
    ["publish", "--tag", tag, "--commit", commit],
    {
      exec(file, args, options) {
        calls.push({ file, args, options });
        return JSON.stringify({
          schemaVersion: 1,
          purpose: "freed-release-tag-publish-result",
          repo: config.repo,
          tag,
          commit,
          tagObjectSha: "b".repeat(40),
          recovered: false,
        });
      },
    },
  );
  assert.deepEqual(
    calls.map(({ options }) => options.timeout),
    [30_000, 120_000],
  );
});

test("publish wrapper requires the exact recoverable native result envelope", () => {
  const { config } = fixture();
  const commit = "a".repeat(40);
  const tag = "v26.7.2000-dev";
  const args = [
    "publish",
    "--tag",
    tag,
    "--commit",
    commit,
  ];
  const result = {
    schemaVersion: 1,
    purpose: "freed-release-tag-publish-result",
    repo: config.repo,
    tag,
    commit,
    tagObjectSha: "b".repeat(40),
    recovered: true,
  };
  assert.deepEqual(
    invokeReleaseTagPublisherAction(config, args, {
      exec: () => JSON.stringify(result),
    }),
    result,
  );
  for (const invalid of [
    { ...result, recovered: "true" },
    Object.fromEntries(
      Object.entries(result).filter(([key]) => key !== "recovered"),
    ),
    { ...result, extra: true },
  ]) {
    assert.throws(
      () =>
        invokeReleaseTagPublisherAction(config, args, {
          exec: () => JSON.stringify(invalid),
        }),
      /inexact publish result/,
    );
  }
});

test("action-specific native envelopes reject old or secret-bearing shapes", () => {
  const { config, attestation } = fixture();
  for (const invalid of [
    { ...attestation, schemaVersion: 2 },
    { ...attestation, secret: "forbidden" },
    { ...attestation, publisherCdHash: "0".repeat(40) },
    { ...attestation, appId: "4296969" },
    { ...attestation, appSlug: "Freed-Release-Publisher" },
  ]) {
    assert.throws(
      () =>
        invokeReleaseTagPublisherAction(
          config,
          [
            "attest",
            "--repo",
            config.repo,
            "--app-id",
            String(config.appId),
            "--app-slug",
            config.appSlug,
          ],
          {
            exec: () => JSON.stringify(invalid),
          },
        ),
      /does not match the pinned short-lived annotated-tag publisher/,
    );
  }
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
  for (const invalidExpected of [
    { ...expected, releaseAppId: "4296969" },
    { ...expected, releaseAppSlug: "Freed-Release-Publisher" },
  ]) {
    assert.throws(
      () =>
        verifyReleaseTagPublisherInstallationReadiness(
          attestation,
          invalidExpected,
        ),
      /does not match the dedicated selected-repository App contract/,
    );
  }
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
    { ...attestation, appId: "4296969" },
    { ...attestation, appSlug: "Freed-Release-Publisher" },
    { ...attestation, accountLogin: "someone-else" },
    { ...attestation, accountType: "User" },
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
